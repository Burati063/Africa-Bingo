import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { retrySchedule, retryPendingReceiptDeposits } from '../src/receipt-deposits.js';
import { setReceiptFetchForTests, verifyReceiptLink } from '../src/receipts.js';

const RECEIPT_URL = 'https://transactioninfo.ethiotelecom.et/receipt/RETRY0TEST1';

function telebirrHtml(account = '0972449537') {
  return `
    <table>
      <tr><td>Transaction Status</td><td>Completed</td></tr>
      <tr><td>Settled Amount</td><td>ETB 150.00</td></tr>
      <tr><td>Credited party account no</td><td>${account}</td></tr>
    </table>`;
}

function htmlFetch(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

test('retry backoff doubles and stops at the attempt limit', () => {
  assert.deepEqual(retrySchedule({ attempts: 0, maxRetries: 3, baseDelayMs: 1000 }), {
    retry: true,
    delayMs: 1000,
  });
  assert.deepEqual(retrySchedule({ attempts: 1, maxRetries: 3, baseDelayMs: 1000 }), {
    retry: true,
    delayMs: 1000,
  });
  assert.deepEqual(retrySchedule({ attempts: 2, maxRetries: 3, baseDelayMs: 1000 }), {
    retry: true,
    delayMs: 2000,
  });
  assert.deepEqual(retrySchedule({ attempts: 3, maxRetries: 3, baseDelayMs: 1000 }), {
    retry: false,
    delayMs: 0,
  });
});

test('retry delay is capped', () => {
  const schedule = retrySchedule({ attempts: 9, maxRetries: 20, baseDelayMs: 1000, maxDelayMs: 5000 });
  assert.equal(schedule.retry, true);
  assert.equal(schedule.delayMs, 5000);
});

test('transient fetch failures are marked retryable', async () => {
  const result = await verifyReceiptLink(RECEIPT_URL, {
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.equal(result.needsReview, true);
  assert.equal(result.retryable, true);
});

test('an account mismatch is not retryable', async () => {
  const result = await verifyReceiptLink(RECEIPT_URL, {
    fetchImpl: htmlFetch(telebirrHtml('0972000000000')),
  });
  assert.equal(result.needsReview, true);
  assert.equal(result.retryable, false);
});

test('a readable matching receipt is credited by the retry worker', async () => {
  const telegramId = `retry-test-${Date.now()}`;
  const user = await prisma.user.create({ data: { telegramId, firstName: 'Retry' } });
  const deposit = await prisma.deposit.create({
    data: {
      userId: user.id,
      amount: 0,
      provider: 'telebirr',
      txRef: `RETRYTEST-${Date.now()}`,
      receiptUrl: RECEIPT_URL,
      status: 'PENDING_REVIEW',
      reviewNote: 'Could not read the amount from this receipt.',
      autoRetry: true,
      nextCheckAt: new Date(Date.now() - 1000),
    },
  });

  try {
    setReceiptFetchForTests(htmlFetch(telebirrHtml()));
    const result = await retryPendingReceiptDeposits({ limit: 5 });

    assert.ok(result.credited >= 1, JSON.stringify(result));

    const updated = await prisma.deposit.findUnique({ where: { id: deposit.id } });
    assert.equal(updated.status, 'VERIFIED');
    assert.equal(updated.amount, 15000);
    assert.equal(updated.autoRetry, false);
    assert.equal(updated.nextCheckAt, null);

    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(freshUser.balance, 15000);

    const ledger = await prisma.transaction.findFirst({
      where: { userId: user.id, type: 'deposit' },
    });
    assert.equal(ledger.amount, 15000);
    assert.equal(ledger.status, 'completed');
  } finally {
    setReceiptFetchForTests(null);
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.deposit.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('a still-unreadable receipt is rescheduled, not credited', async () => {
  const telegramId = `retry-test-${Date.now()}-b`;
  const user = await prisma.user.create({ data: { telegramId, firstName: 'Retry' } });
  const deposit = await prisma.deposit.create({
    data: {
      userId: user.id,
      amount: 0,
      provider: 'telebirr',
      txRef: `RETRYTEST-${Date.now()}-b`,
      receiptUrl: RECEIPT_URL,
      status: 'PENDING_REVIEW',
      reviewNote: 'Could not read the amount from this receipt.',
      autoRetry: true,
      nextCheckAt: new Date(Date.now() - 1000),
    },
  });

  try {
    setReceiptFetchForTests(
      async () => new Response('<html><body>Loading…</body></html>', { status: 200 }),
    );
    const result = await retryPendingReceiptDeposits({ limit: 5 });
    assert.ok(result.rescheduled >= 1, JSON.stringify(result));

    const updated = await prisma.deposit.findUnique({ where: { id: deposit.id } });
    assert.equal(updated.status, 'PENDING_REVIEW');
    assert.equal(updated.retryCount, 1);
    assert.equal(updated.autoRetry, true);
    assert.ok(updated.nextCheckAt && updated.nextCheckAt > new Date());

    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(freshUser.balance, 0);
  } finally {
    setReceiptFetchForTests(null);
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.deposit.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
