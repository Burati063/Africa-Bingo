import { prisma } from './db.js';
import { getSettings } from './settings.js';
import { AppError } from './util.js';
import { emitToUser } from './realtime.js';
import { onDepositVerified } from './agents.js';
import { hashReceiptLink, verifyReceiptLink } from './receipts.js';

const RETRY_MAX = Math.max(1, Number(process.env.RECEIPT_RETRY_MAX || 5));
const RETRY_BASE_MS = Math.max(5000, Number(process.env.RECEIPT_RETRY_BASE_MS || 60_000));

export function getReceiptRetrySettings() {
  return { maxRetries: RETRY_MAX, baseDelayMs: RETRY_BASE_MS };
}

/**
 * Exponential backoff for automatic receipt re-checks. `attempts` is the number
 * of failed checks already recorded for the deposit.
 */
export function retrySchedule({ attempts, maxRetries = RETRY_MAX, baseDelayMs = RETRY_BASE_MS, maxDelayMs = 3_600_000 }) {
  const made = Math.max(0, Number(attempts) || 0);
  const limit = Math.max(1, Number(maxRetries) || 1);
  if (made >= limit) return { retry: false, delayMs: 0 };
  const delay = Math.min(maxDelayMs, Math.max(0, Number(baseDelayMs) || 0) * 2 ** Math.max(0, made - 1));
  return { retry: true, delayMs: delay };
}

function receiptSnapshot(parsed) {
  if (!parsed) return null;
  return JSON.stringify({
    provider: parsed.provider,
    reference: parsed.reference,
    amountSantim: parsed.amountSantim,
    currency: parsed.currency,
    status: parsed.status,
    payerName: parsed.payerName,
    receiverName: parsed.receiverName,
    receiverAccount: parsed.receiverAccount,
    paidAt: parsed.paidAt,
  }).slice(0, 4000);
}

export async function verifyReceiptDeposit(user, rawInput) {
  if (user.isBanned) throw new AppError('This account is suspended.', 403);

  const verification = await verifyReceiptLink(rawInput);
  const parsed = verification.parsed;
  const settings = getSettings();
  const maxAutoVerify = Number(settings.maxAutoVerify) || 0;
  const amount = parsed?.amountSantim || 0;
  const overLimit = amount > maxAutoVerify;
  const needsReview = verification.needsReview || overLimit || amount <= 0;

  // Use the provider's transaction reference when we could read the receipt.
  // Otherwise fall back to a hash of the link: links like CBE PDF receipts have
  // no readable reference, and the same link must never be submitted twice.
  const reference = String(
    parsed?.reference || hashReceiptLink(verification.receiptUrl || rawInput),
  ).slice(0, 100);
  const txRef = reference;

  const existing = await prisma.deposit.findUnique({ where: { txRef } });
  if (existing) {
    throw new AppError('This transaction has already been submitted.', 409);
  }

  const reason = [
    verification.reason,
    overLimit ? `Amount exceeds the auto-verify limit (${maxAutoVerify / 100} ETB).` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Over-limit deposits need a human. Everything else that failed for a
  // transient reason gets a few automatic re-checks first.
  const retryable = Boolean(needsReview && !overLimit && verification.retryable && verification.receiptUrl);

  let deposit;
  try {
    deposit = await prisma.$transaction(async (tx) => {
      const created = await tx.deposit.create({
        data: {
          userId: user.id,
          amount,
          provider: verification.provider || 'unknown',
          txRef,
          providerRef: parsed?.receiptNo || null,
          paymentMethod: verification.provider || null,
          receiptUrl: verification.receiptUrl,
          receiptData: receiptSnapshot(parsed),
          status: needsReview ? 'PENDING_REVIEW' : 'VERIFIED',
          reviewNote: needsReview ? reason || 'Could not verify this receipt automatically.' : null,
          verifiedAt: needsReview ? null : new Date(),
          autoRetry: retryable,
          nextCheckAt: retryable ? new Date(Date.now() + RETRY_BASE_MS) : null,
        },
      });

      if (!needsReview) {
        await tx.user.update({
          where: { id: user.id },
          data: { balance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: 'deposit',
            amount,
            status: 'completed',
            reference: txRef,
            meta: `deposit:${created.id}`,
          },
        });
      }
      return created;
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AppError('This transaction has already been submitted.', 409);
    }
    throw err;
  }

  if (needsReview) {
    return {
      status: 'pending_review',
      depositId: deposit.id,
      provider: verification.provider,
      txRef,
      amount,
      message: reason
        ? `We could not verify this receipt automatically (${reason}). It was sent to admin review.`
        : 'Your payment was submitted for manual review.',
    };
  }

  try {
    await onDepositVerified(user.id, amount);
  } catch (err) {
    console.error('[deposits] agent commission failed', err);
  }

  const updatedUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { balance: true },
  });
  emitToUser(user.id, 'balance', { balance: updatedUser?.balance ?? 0 });

  return {
    status: 'verified',
    depositId: deposit.id,
    amount,
    balance: updatedUser?.balance ?? 0,
    provider: verification.provider,
    txRef,
    message: `${amount / 100} ETB added to your balance.`,
  };
}

/**
 * Re-check deposits that failed for a transient reason. A receipt that is now
 * readable, settled and paid to the platform account is credited exactly like a
 * normal verified deposit; everything else is rescheduled (with backoff) or
 * handed to manual review once the attempts are exhausted.
 */
export async function retryPendingReceiptDeposits({ limit = 10, fetchImpl, now = new Date() } = {}) {
  const settings = getSettings();
  const maxAutoVerify = Number(settings.maxAutoVerify) || 0;
  const pending = await prisma.deposit.findMany({
    where: {
      status: 'PENDING_REVIEW',
      autoRetry: true,
      receiptUrl: { not: null },
      nextCheckAt: { lte: now },
    },
    orderBy: { nextCheckAt: 'asc' },
    take: Math.max(1, Math.min(50, Number(limit) || 10)),
  });

  const result = { checked: 0, credited: 0, rescheduled: 0, exhausted: 0 };

  for (const deposit of pending) {
    result.checked += 1;
    let verification;
    try {
      verification = await verifyReceiptLink(
        deposit.receiptUrl,
        fetchImpl ? { fetchImpl } : {},
      );
    } catch (err) {
      // Invalid/blocked links can never succeed on a re-check.
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          autoRetry: false,
          nextCheckAt: null,
          reviewNote: `${deposit.reviewNote || 'Receipt could not be read.'} (${err.message})`,
        },
      });
      result.exhausted += 1;
      continue;
    }

    const parsed = verification.parsed;
    const amount = parsed?.amountSantim || 0;
    const canCredit =
      !verification.needsReview &&
      parsed?.ok &&
      parsed.currency === 'ETB' &&
      amount > 0 &&
      amount <= maxAutoVerify;

    if (!canCredit) {
      const attempts = deposit.retryCount + 1;
      // A definitive answer (wrong account, wrong currency) cannot improve on a
      // re-check, so stop retrying and hand it straight to manual review.
      const schedule =
        verification.retryable === false
          ? { retry: false, delayMs: 0 }
          : retrySchedule({ attempts, maxRetries: RETRY_MAX, baseDelayMs: RETRY_BASE_MS });
      const note =
        verification.reason ||
        `Automatic re-check could not verify this receipt (attempt ${attempts}).`;

      await prisma.deposit.update({
        where: { id: deposit.id },
        data: schedule.retry
          ? {
              retryCount: attempts,
              nextCheckAt: new Date(now.getTime() + schedule.delayMs),
              reviewNote: `${note} Re-checking automatically.`,
            }
          : {
              retryCount: attempts,
              autoRetry: false,
              nextCheckAt: null,
              reviewNote: `${note} Automatic re-check failed after ${attempts} attempts; review manually.`,
            },
      });
      if (schedule.retry) result.rescheduled += 1;
      else result.exhausted += 1;
      continue;
    }

    const credited = await prisma.$transaction(async (tx) => {
      const updated = await tx.deposit.updateMany({
        where: { id: deposit.id, status: 'PENDING_REVIEW' },
        data: {
          status: 'VERIFIED',
          amount,
          providerRef: parsed.receiptNo || deposit.providerRef,
          receiptData: receiptSnapshot(parsed),
          reviewNote: null,
          autoRetry: false,
          nextCheckAt: null,
          verifiedAt: new Date(),
        },
      });
      if (!updated.count) return false;
      await tx.user.update({
        where: { id: deposit.userId },
        data: { balance: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId: deposit.userId,
          type: 'deposit',
          amount,
          status: 'completed',
          reference: deposit.txRef,
          meta: `deposit:${deposit.id}`,
        },
      });
      return true;
    });

    if (!credited) continue;
    result.credited += 1;

    try {
      await onDepositVerified(deposit.userId, amount);
    } catch (err) {
      console.error('[deposits] agent commission failed', err);
    }
    const user = await prisma.user.findUnique({
      where: { id: deposit.userId },
      select: { balance: true },
    });
    emitToUser(deposit.userId, 'balance', { balance: user?.balance ?? 0 });
  }

  return result;
}
