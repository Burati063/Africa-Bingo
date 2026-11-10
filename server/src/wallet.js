import { prisma } from './db.js';
import { getSettings } from './settings.js';
import { AppError } from './util.js';
import { parsePaymentSms } from './payments.js';
import { emitToUser } from './realtime.js';
import { onDepositVerified } from './agents.js';

// Payment / payout destinations currently supported by the platform.
// Unsupported banks and wallets have been removed from the list on purpose.
export const BANKS = [
  'Telebirr',
  'Commercial Bank of Ethiopia (CBE)',
  'Awash Bank',
  'Dashen Bank',
  'Bank of Abyssinia',
  'Hibret Bank',
  'Wegagen Bank',
  'Nib International Bank',
  'Cooperative Bank of Oromia',
  'Bunna Bank',
  'Berhan Bank',
  'Abay Bank',
  'Amhara Bank',
  'Tsehay Bank',
  'Gadaa Bank',
  'Siinqee Bank',
  'Ahadu Bank',
  'Tsedey Bank',
];

async function pushBalance(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { balance: true } });
  if (user) emitToUser(userId, 'balance', { balance: user.balance });
  return user?.balance ?? 0;
}

export async function verifyDeposit(user, rawSms, expectedAmountSantim = null) {
  if (user.isBanned) throw new AppError('This account is suspended.', 403);
  const smsEnabled =
    process.env.ALLOW_SMS_VERIFICATION === 'true' || String(getSettings().smsAllowed) === '1';
  if (!smsEnabled) {
    throw new AppError('SMS verification is disabled. Paste the transaction link instead.', 403);
  }
  const parsed = parsePaymentSms(rawSms);
  if (parsed.error) throw new AppError(parsed.error);
  if (!parsed.txRef) {
    throw new AppError('Could not find a transaction number in this message. Paste the full SMS.');
  }

  const duplicate = await prisma.deposit.findUnique({ where: { txRef: parsed.txRef } });
  if (duplicate) throw new AppError('This transaction has already been submitted.', 409);

  const settings = getSettings();
  const amount =
    parsed.amountSantim ||
    (Number.isFinite(expectedAmountSantim) && expectedAmountSantim > 0 ? expectedAmountSantim : null);
  const needsReview = !amount || amount > Number(settings.maxAutoVerify);

  const deposit = await prisma.deposit.create({
    data: {
      userId: user.id,
      amount: amount || 0,
      provider: parsed.provider,
      txRef: parsed.txRef,
      rawSms: parsed.raw,
      status: needsReview ? 'PENDING_REVIEW' : 'VERIFIED',
      verifiedAt: needsReview ? null : new Date(),
    },
  });

  if (needsReview) {
    return {
      status: 'pending_review',
      depositId: deposit.id,
      message:
        'Your payment was submitted for manual review. An admin will confirm it shortly — usually within 15–30 minutes.',
    };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { balance: { increment: amount } } }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'deposit',
        amount,
        status: 'completed',
        reference: parsed.txRef,
        meta: `deposit:${deposit.id}`,
      },
    }),
    prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'VERIFIED', verifiedAt: new Date() } }),
  ]);

  await onDepositVerified(user.id, amount);
  const balance = await pushBalance(user.id);

  return {
    status: 'verified',
    amount,
    balance,
    provider: parsed.provider,
    txRef: parsed.txRef,
    message: `${amount / 100} ETB added to your balance.`,
  };
}

export async function approveDeposit(depositId, staffId, amountOverride = null) {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new AppError('Deposit not found', 404);
  if (deposit.status !== 'PENDING_REVIEW') throw new AppError('This deposit is not pending review.');
  const settings = getSettings();
  const amount = amountOverride || deposit.amount;
  if (!amount || amount <= 0) throw new AppError('Enter the deposited amount before approving.');
  if (amount > Number(settings.maxAutoVerify) * 5) {
    throw new AppError('Amount looks unusually large. Double-check the receipt before approving.');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: deposit.userId }, data: { balance: { increment: amount } } }),
    prisma.transaction.create({
      data: {
        userId: deposit.userId,
        type: 'deposit',
        amount,
        status: 'completed',
        reference: deposit.txRef,
        meta: `deposit:${deposit.id}`,
      },
    }),
    prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: 'VERIFIED', amount, verifiedAt: new Date() },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'deposit_approve', details: `deposit:${deposit.id} amount:${amount}` },
    }),
  ]);

  await onDepositVerified(deposit.userId, amount);
  await pushBalance(deposit.userId);
  return { ok: true, amount };
}

export async function rejectDeposit(depositId, staffId, note) {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new AppError('Deposit not found', 404);
  if (deposit.status !== 'PENDING_REVIEW') throw new AppError('This deposit is not pending review.');
  await prisma.$transaction([
    prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: 'REJECTED', reviewNote: note || 'Rejected by admin' },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'deposit_reject', details: `deposit:${deposit.id} ${note || ''}` },
    }),
  ]);
  await pushBalance(deposit.userId);
  return { ok: true };
}

export async function requestWithdrawal(user, { amountSantim, bank, accountNumber, accountName }) {
  if (user.isBanned) throw new AppError('This account is suspended.', 403);
  const settings = getSettings();
  const amount = Number(amountSantim);
  const bankName = String(bank || '').trim();
  const account = String(accountNumber || '').trim();
  const holder = String(accountName || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Enter a valid withdrawal amount.');
  if (amount < Number(settings.minWithdraw)) {
    throw new AppError(`Minimum withdrawal is ${Number(settings.minWithdraw) / 100} ETB.`);
  }
  if (!BANKS.includes(bankName)) throw new AppError('Select a valid bank / wallet.');
  if (account.length < 5) throw new AppError('Enter a valid account number.');
  if (holder.length < 2) throw new AppError('Enter the account holder name.');

  const existingPending = await prisma.withdrawal.findFirst({
    where: { userId: user.id, status: 'PENDING' },
  });
  if (existingPending) throw new AppError('You already have a withdrawal request pending approval.');

  const reserved = await prisma.user.updateMany({
    where: { id: user.id, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (reserved.count === 0) throw new AppError('Insufficient balance.');

  const withdrawal = await prisma.withdrawal.create({
    data: { userId: user.id, amount, bank: bankName, accountNumber: account, accountName: holder },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: 'withdrawal',
      amount,
      status: 'pending',
      reference: `wd:${withdrawal.id}`,
      meta: `${bankName} ${account}`,
    },
  });

  const balance = await pushBalance(user.id);
  return { ...withdrawal, balance };
}

export async function approveWithdrawal(withdrawalId, staffId, note = null) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new AppError('Withdrawal not found', 404);
  if (withdrawal.status !== 'PENDING') throw new AppError('This withdrawal was already processed.');

  await prisma.$transaction([
    prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'APPROVED', adminNotes: note, processedAt: new Date() },
    }),
    prisma.transaction.updateMany({
      where: { reference: `wd:${withdrawal.id}`, status: 'pending' },
      data: { status: 'completed' },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'withdrawal_approve', details: `withdrawal:${withdrawal.id} amount:${withdrawal.amount}` },
    }),
  ]);
  return { ok: true };
}

export async function rejectWithdrawal(withdrawalId, staffId, note) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new AppError('Withdrawal not found', 404);
  if (withdrawal.status !== 'PENDING') throw new AppError('This withdrawal was already processed.');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: withdrawal.userId },
      data: { balance: { increment: withdrawal.amount } },
    }),
    prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REJECTED', adminNotes: note || 'Rejected', processedAt: new Date() },
    }),
    prisma.transaction.updateMany({
      where: { reference: `wd:${withdrawal.id}`, status: 'pending' },
      data: { status: 'rejected' },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'withdrawal_reject', details: `withdrawal:${withdrawal.id} ${note || ''}` },
    }),
  ]);
  await pushBalance(withdrawal.userId);
  return { ok: true };
}

export async function requestAgentWithdrawal(agent, { amountSantim, bank, accountNumber, accountName }) {
  const settings = getSettings();
  const amount = Number(amountSantim);
  const bankName = String(bank || '').trim();
  const account = String(accountNumber || '').trim();
  const holder = String(accountName || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Enter a valid withdrawal amount.');
  if (amount < Number(settings.agentMinWithdraw)) {
    throw new AppError(`Minimum agent withdrawal is ${Number(settings.agentMinWithdraw) / 100} ETB.`);
  }
  if (!BANKS.includes(bankName)) throw new AppError('Select a valid bank / wallet.');
  if (account.length < 5) throw new AppError('Enter a valid account number.');
  if (holder.length < 2) throw new AppError('Enter the account holder name.');

  const pending = await prisma.agentWithdrawal.findFirst({ where: { agentId: agent.id, status: 'PENDING' } });
  if (pending) throw new AppError('You already have a commission withdrawal pending approval.');

  const reserved = await prisma.agent.updateMany({
    where: { id: agent.id, commissionBalance: { gte: amount } },
    data: { commissionBalance: { decrement: amount } },
  });
  if (reserved.count === 0) throw new AppError('Insufficient commission balance.');

  const withdrawal = await prisma.agentWithdrawal.create({
    data: { agentId: agent.id, amount, bank: bankName, accountNumber: account, accountName: holder },
  });
  await prisma.agentTransaction.create({
    data: {
      agentId: agent.id,
      type: 'withdrawal',
      amount: -amount,
      status: 'pending',
      note: `${bankName} ${account}`,
    },
  });
  return withdrawal;
}

export async function approveAgentWithdrawal(withdrawalId, staffId, note = null) {
  const withdrawal = await prisma.agentWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new AppError('Agent withdrawal not found', 404);
  if (withdrawal.status !== 'PENDING') throw new AppError('This withdrawal was already processed.');

  await prisma.$transaction([
    prisma.agentWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'APPROVED', adminNotes: note, processedAt: new Date() },
    }),
    prisma.agentTransaction.updateMany({
      where: { agentId: withdrawal.agentId, type: 'withdrawal', status: 'pending', amount: -withdrawal.amount },
      data: { status: 'completed' },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'agent_withdrawal_approve', details: `agent_withdrawal:${withdrawal.id}` },
    }),
  ]);
  return { ok: true };
}

export async function rejectAgentWithdrawal(withdrawalId, staffId, note) {
  const withdrawal = await prisma.agentWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new AppError('Agent withdrawal not found', 404);
  if (withdrawal.status !== 'PENDING') throw new AppError('This withdrawal was already processed.');

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: withdrawal.agentId },
      data: { commissionBalance: { increment: withdrawal.amount } },
    }),
    prisma.agentWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REJECTED', adminNotes: note || 'Rejected', processedAt: new Date() },
    }),
    prisma.agentTransaction.updateMany({
      where: { agentId: withdrawal.agentId, type: 'withdrawal', status: 'pending', amount: -withdrawal.amount },
      data: { status: 'rejected' },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'agent_withdrawal_reject', details: `agent_withdrawal:${withdrawal.id} ${note || ''}` },
    }),
  ]);
  return { ok: true };
}

export async function adjustBalance(userId, amountSantim, staffId, reason) {
  const amount = Number(amountSantim);
  if (!Number.isFinite(amount) || amount === 0) throw new AppError('Enter a non-zero amount.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);
  if (user.balance + amount < 0) throw new AppError('Adjustment would make the balance negative.');

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { balance: { increment: amount } } }),
    prisma.transaction.create({
      data: {
        userId,
        type: 'adjustment',
        amount,
        status: 'completed',
        reference: `admin:${staffId}`,
        meta: reason || null,
      },
    }),
    prisma.adminAction.create({
      data: { staffId, actionType: 'balance_adjust', details: `user:${userId} amount:${amount} ${reason || ''}` },
    }),
  ]);
  const balance = await pushBalance(userId);
  return { ok: true, balance };
}
