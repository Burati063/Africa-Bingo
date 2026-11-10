import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import {
  BANKS,
  approveWithdrawal,
  rejectWithdrawal,
  requestWithdrawal,
} from '../src/wallet.js';

const BANK = BANKS[0];

async function makePlayer(balanceSantim) {
  return prisma.user.create({
    data: {
      telegramId: `wd-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      firstName: 'Withdraw Test',
      balance: balanceSantim,
    },
  });
}

async function cleanup(user) {
  // Children first: the ledger and requests reference the user.
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

const request = (user, amountSantim) =>
  requestWithdrawal(user, {
    amountSantim,
    bank: BANK,
    accountNumber: '0911223344',
    accountName: 'Withdraw Test',
  });

test('requesting a withdrawal reserves the balance and writes a pending row', async () => {
  const user = await makePlayer(20000);
  try {
    const withdrawal = await request(user, 6000);
    assert.equal(withdrawal.amount, 6000);
    assert.equal(withdrawal.status, 'PENDING');
    assert.equal(withdrawal.balance, 14000);

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(fresh.balance, 14000);

    const ledger = await prisma.transaction.findFirst({
      where: { userId: user.id, type: 'withdrawal' },
    });
    assert.equal(ledger.amount, 6000);
    assert.equal(ledger.status, 'pending');

    // A second request cannot be opened while one is pending.
    await assert.rejects(() => request(user, 5000), /already have a withdrawal/i);

    const afterRetry = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(afterRetry.balance, 14000);
  } finally {
    await cleanup(user);
  }
});

test('insufficient balance is rejected without touching the wallet', async () => {
  const user = await makePlayer(1000);
  try {
    await assert.rejects(() => request(user, 5000), /Insufficient balance/i);
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(fresh.balance, 1000);
    const count = await prisma.withdrawal.count({ where: { userId: user.id } });
    assert.equal(count, 0);
  } finally {
    await cleanup(user);
  }
});

test('amounts below the minimum and invalid bank details are rejected', async () => {
  const user = await makePlayer(20000);
  try {
    await assert.rejects(() => request(user, 4999), /Minimum withdrawal/i);
    await assert.rejects(
      () =>
        requestWithdrawal(user, {
          amountSantim: 6000,
          bank: 'Not A Bank',
          accountNumber: '0911223344',
          accountName: 'Withdraw Test',
        }),
      /valid bank/i,
    );
    await assert.rejects(
      () =>
        requestWithdrawal(user, {
          amountSantim: 6000,
          bank: BANK,
          accountNumber: '12',
          accountName: 'Withdraw Test',
        }),
      /account number/i,
    );

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(fresh.balance, 20000);
  } finally {
    await cleanup(user);
  }
});

test('approval confirms the payout without changing the reserved balance', async () => {
  const user = await makePlayer(20000);
  try {
    const withdrawal = await request(user, 6000);
    await approveWithdrawal(withdrawal.id, null, 'Sent via Telebirr');

    const processed = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    assert.equal(processed.status, 'APPROVED');
    assert.equal(processed.adminNotes, 'Sent via Telebirr');
    assert.ok(processed.processedAt);

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(fresh.balance, 14000, 'approval must not refund or double-charge');

    const ledger = await prisma.transaction.findFirst({
      where: { userId: user.id, reference: `wd:${withdrawal.id}` },
    });
    assert.equal(ledger.status, 'completed');

    // Approving twice is refused.
    await assert.rejects(() => approveWithdrawal(withdrawal.id, null), /already processed/i);
  } finally {
    await cleanup(user);
  }
});

test('rejection refunds the reserved amount exactly once', async () => {
  const user = await makePlayer(20000);
  try {
    const withdrawal = await request(user, 6000);
    await rejectWithdrawal(withdrawal.id, null, 'Account name mismatch');

    const processed = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    assert.equal(processed.status, 'REJECTED');
    assert.equal(processed.adminNotes, 'Account name mismatch');

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(fresh.balance, 20000, 'rejection must refund the reserved amount');

    const ledger = await prisma.transaction.findFirst({
      where: { userId: user.id, reference: `wd:${withdrawal.id}` },
    });
    assert.equal(ledger.status, 'rejected');

    // Rejecting twice must not refund twice.
    await assert.rejects(() => rejectWithdrawal(withdrawal.id, null, 'again'), /already processed/i);
    const afterRetry = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(afterRetry.balance, 20000);
  } finally {
    await cleanup(user);
  }
});
