import crypto from 'node:crypto';
import { AppError } from './util.js';
import { field } from './field.js';

/**
 * Telebirr / CBE receipt-link verification.
 *
 * Players paste the receipt link they received from Telebirr or the CBE app.
 * The server fetches the official receipt page, extracts the amount, status,
 * reference and receiving account, and only credits when the money went to the
 * configured platform account.
 *
 * Notes:
 *  - Only official receipt hosts are fetched (SSRF allowlist).
 *  - Telebirr's receipt endpoint is sometimes reachable only from Ethiopia. If
 *    the fetch fails, the deposit is sent to admin review instead of credited.
 *  - CBE's public receipt API headers are not formally documented; they can be
 *    overridden with CBE_APP_ID / CBE_APP_VERSION, and a failure falls back to
 *    review.
 */
const TELEBIRR_HOST = 'transactioninfo.ethiotelecom.et';
const CBE_SHORT_HOST = 'mbreciept.cbe.com.et';
const CBE_API_HOST = 'mb.cbe.com.et';
const CBEBIRR_HOST = 'cbepay1.cbe.com.et';
const CBE_PDF_HOST = 'apps.cbe.com.et';

const MAX_BODY_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = Number(process.env.RECEIPT_FETCH_TIMEOUT_MS || 12000);
const CBE_APP_ID = process.env.CBE_APP_ID || 'd1292e42-7400-49de-a2d3-9731caa4c819';
const CBE_APP_VERSION = process.env.CBE_APP_VERSION || '0a01980b-9859-1369-8198-59f403820000';

// Read lazily so tests (and dotenv-loaded env at startup) always see the
// current account settings.
function receivers() {
  return {
    telebirr: {
      account: process.env.DEPOSIT_TELEBIRR_ACCOUNT || '0972449537',
      name: process.env.DEPOSIT_TELEBIRR_NAME || 'Leul',
    },
    cbe: {
      account: process.env.DEPOSIT_CBE_ACCOUNT || '1000574677487',
      name: process.env.DEPOSIT_CBE_NAME || 'SILMA',
    },
    cbebirr: {
      account: process.env.DEPOSIT_CBEBIRR_ACCOUNT || '',
      name: process.env.DEPOSIT_CBEBIRR_NAME || '',
    },
  };
}

export class ReceiptError extends AppError {
  constructor(message, code = 'invalid_receipt') {
    super(message, 422);
    this.code = code;
  }
}

let fetchImplementation = (...args) => fetch(...args);

export function setReceiptFetchForTests(fn) {
  fetchImplementation = fn || ((...args) => fetch(...args));
}

function cleanUrl(value) {
  return String(value || '')
    .trim()
    .replace(/[)\].,;!]+$/, '');
}

export function extractReceiptLink(input) {
  const text = String(input || '').trim();
  if (!text) throw new ReceiptError('Paste the transaction link from your payment receipt.');

  const url = text.match(/https?:\/\/[^\s<>"']+/i);
  if (url) return cleanUrl(url[0]);

  // A bare Telebirr transaction number is also accepted.
  if (/^[A-Za-z0-9]{8,24}$/.test(text)) {
    return `https://${TELEBIRR_HOST}/receipt/${text.toUpperCase()}`;
  }

  throw new ReceiptError(
    'Paste the full receipt link. For Telebirr you can also enter the transaction number.',
  );
}

export function classifyReceiptLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new ReceiptError('That receipt link is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new ReceiptError('Receipt links must use https.');
  if (url.username || url.password) throw new ReceiptError('That receipt link is not allowed.');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (host === TELEBIRR_HOST) {
    const parts = url.pathname.split('/').filter(Boolean);
    let reference = null;
    if (parts[0] === 'receipt' && parts[1] && parts[1] !== 'view') reference = parts[1];
    if (parts[0] === 'receipt' && parts[1] === 'view') {
      reference = url.searchParams.get('transactionno') || url.searchParams.get('id');
    }
    if (!reference || !/^[A-Za-z0-9]{6,32}$/.test(reference)) {
      throw new ReceiptError('This Telebirr receipt link does not contain a transaction number.');
    }
    return {
      kind: 'telebirr',
      provider: 'telebirr',
      reference: reference.toUpperCase(),
      url: link,
    };
  }

  if (host === CBE_SHORT_HOST) {
    const token = url.pathname.split('/').filter(Boolean).pop();
    if (!token) throw new ReceiptError('This CBE receipt link is missing its receipt ID.');
    if (token.includes('-')) {
      return { kind: 'cbe-pdf', provider: 'cbe', reference: token, url: link };
    }
    if (!/^[A-Za-z0-9]{8,100}$/.test(token)) {
      throw new ReceiptError('This CBE receipt ID is not valid.');
    }
    return { kind: 'cbe', provider: 'cbe', reference: token, url: link, token };
  }

  if (host === CBE_API_HOST) {
    const token = url.pathname.split('/').filter(Boolean).pop();
    if (!token || !/^[A-Za-z0-9-]{8,100}$/.test(token)) {
      throw new ReceiptError('This CBE receipt API link is not valid.');
    }
    return { kind: 'cbe', provider: 'cbe', reference: token, url: link, token };
  }

  if (host === CBEBIRR_HOST) {
    const tid = url.searchParams.get('TID') || url.searchParams.get('tid');
    if (!tid || !/^[A-Za-z0-9]{6,32}$/.test(tid)) {
      throw new ReceiptError('This CBE Birr receipt link does not contain a transaction number.');
    }
    return {
      kind: 'cbebirr',
      provider: 'cbebirr',
      reference: tid.toUpperCase(),
      url: link,
    };
  }

  if (host === CBE_PDF_HOST) {
    return { kind: 'cbe-pdf', provider: 'cbe', reference: 'CBE-PDF', url: link };
  }

  throw new ReceiptError('Only official Telebirr and CBE receipt links are accepted.');
}

async function fetchPage(url, { accept = 'text/html,application/xhtml+xml' } = {}) {
  let res;
  try {
    res = await fetchImplementation(url, {
      redirect: 'error',
      headers: {
        Accept: accept,
        'User-Agent': 'EthioBingo/1.0 (+receipt verification)',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ReceiptError(`Could not open the receipt link (${err.message}).`, 'fetch_failed');
  }

  if (!res.ok) {
    throw new ReceiptError(`The receipt page returned HTTP ${res.status}.`, 'fetch_failed');
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    throw new ReceiptError('The receipt page is too large.', 'fetch_failed');
  }
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ReceiptError('The receipt page is too large.', 'fetch_failed');
  }
  return text;
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th|tr|div|p|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  );
}


export function parseAmountSantim(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/,/g, '');
  const match = cleaned.match(/(\d+(?:\.\d{1,4})?)/);
  if (!match) return 0;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function statusIsSuccess(status) {
  if (!status) return false;
  return /(complete|completed|success|successful|paid|approved)/i.test(status);
}

export function parseTelebirrReceipt(html, reference) {
  const text = htmlToText(html);
  const receiptNo = field(text, ['Receipt No', 'Receipt Number', 'Transaction No']);
  const status = field(text, ['Transaction Status', 'transaction status', 'Status']);
  const amountRaw = field(text, ['Settled Amount', 'Total Paid Amount', 'Paid Amount', 'Amount']);
  const amountSantim = parseAmountSantim(amountRaw);
  const receiverName = field(text, [
    'Credited Party name',
    'Credited Party Name',
    'Credited party name',
  ]);
  const receiverAccount = field(text, [
    'Credited party account no',
    'Credited Party account no',
    'Credited party Telebirr No',
    'Credited Party Account',
  ]);
  const payerName = field(text, ['Payer Name', 'Payer name']);
  const paidAt = field(text, ['Payment date', 'Payment Date', 'Transaction Date']);

  return {
    provider: 'telebirr',
    reference: String(reference || receiptNo || '').toUpperCase(),
    receiptNo: receiptNo || reference || null,
    amountSantim,
    currency: 'ETB',
    status: status || 'Unknown',
    ok: statusIsSuccess(status) && amountSantim > 0,
    payerName,
    receiverName,
    receiverAccount,
    paidAt,
    receiptUrl: null,
  };
}

export function parseCbeJson(json, reference) {
  const data = json?.data && typeof json.data === 'object' ? json.data : json;
  if (!data || typeof data !== 'object') throw new ReceiptError('CBE returned an unreadable receipt.');

  const amountRaw =
    data.amountCredited ?? data.amount ?? data.transactionAmount ?? data.creditAmount ?? null;
  const amountSantim = parseAmountSantim(amountRaw);
  const rawStatus = data.status ?? data.transactionStatus ?? null;
  const status = rawStatus ? String(rawStatus) : 'Completed';
  const receiverAccount = data.creditAccountNo || data.creditAccount || null;
  const receiverName = data.creditName || data.creditedPartyName || data.creditAccountName || null;
  const payerName = data.debitName || data.payerName || data.debitAccountName || null;
  const paidAt = data.transactionDate || data.date || data.createdAt || null;

  return {
    provider: 'cbe',
    reference: String(data.id || data.transactionId || data.reference || reference || ''),
    receiptNo: data.id || data.transactionId || reference || null,
    amountSantim,
    currency: String(data.creditCurrency || data.currency || 'ETB').toUpperCase(),
    status,
    // The public transaction-detail endpoint only returns completed receipts,
    // but if it does expose a status, require a successful one.
    ok: amountSantim > 0 && (!rawStatus || statusIsSuccess(status)),
    payerName,
    receiverName,
    receiverAccount,
    paidAt,
    receiptUrl: null,
  };
}

export function parseCbeBirrReceipt(html, reference) {
  const text = htmlToText(html);
  const status = field(text, ['Transaction Status', 'Status']);
  const amountRaw = field(text, ['Amount', 'Total Amount', 'Paid Amount']);
  const amountSantim = parseAmountSantim(amountRaw);
  const receiverName = field(text, ['Credited Party', 'Receiver Name', 'Merchant Name']);
  const receiverAccount = field(text, ['Credited Account', 'Receiver Account', 'Merchant Account']);
  const payerName = field(text, ['Payer Name', 'Customer Name']);
  const paidAt = field(text, ['Transaction Date', 'Payment Date', 'Date']);

  return {
    provider: 'cbebirr',
    reference: String(reference || '').toUpperCase(),
    receiptNo: reference || null,
    amountSantim,
    currency: 'ETB',
    status: status || 'Unknown',
    ok: statusIsSuccess(status) && amountSantim > 0,
    payerName,
    receiverName,
    receiverAccount,
    paidAt,
    receiptUrl: null,
  };
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function accountMatches(receiptAccount, expectedAccount) {
  if (!receiptAccount || !expectedAccount) return null;
  const receiptDigits = digits(receiptAccount);
  const expectedDigits = digits(expectedAccount);
  if (!receiptDigits || !expectedDigits) return null;
  if (/[*xX]/.test(String(receiptAccount))) {
    if (receiptDigits.length < 4) return null;
    return expectedDigits.endsWith(receiptDigits.slice(-4));
  }
  return (
    receiptDigits === expectedDigits ||
    receiptDigits.endsWith(expectedDigits) ||
    expectedDigits.endsWith(receiptDigits)
  );
}

function nameMatches(receiptName, expectedName) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = normalize(receiptName);
  const b = normalize(expectedName);
  if (!a || !b) return null;
  return a.includes(b) || b.includes(a);
}

function receiverVerdict(receipt) {
  const expected = receivers()[receipt.provider];
  if (!expected) return { ok: true };
  const accountMatch = accountMatches(receipt.receiverAccount, expected.account);
  if (accountMatch === false) {
    return { ok: false, reason: 'This receipt was not paid to the platform account.' };
  }
  if (accountMatch === true) return { ok: true };

  const nameMatch = nameMatches(receipt.receiverName, expected.name);
  if (nameMatch === false && !receipt.receiverAccount) {
    return { ok: false, reason: 'This receipt was not paid to the platform account.' };
  }
  return { ok: true };
}

function reviewResult(target, reason, parsed = null, link = target.url, retryable = false) {
  return {
    needsReview: true,
    reason,
    provider: target.provider,
    reference: target.reference,
    receiptUrl: link,
    parsed,
    // Transient failures (provider unreachable, page not settled yet, amount
    // unreadable) are worth re-checking automatically before manual review.
    retryable,
  };
}

export async function verifyReceiptLink(rawInput, options = {}) {
  const link = extractReceiptLink(rawInput);
  const target = classifyReceiptLink(link);
  const doFetch = options.fetchImpl || fetchImplementation;

  if (target.kind === 'cbe-pdf') {
    return reviewResult(
      target,
      'CBE PDF receipts are verified manually. Paste the CBE app share link instead if you have it.',
    );
  }

  try {
    let parsed;
    if (target.kind === 'telebirr') {
      const html = await doFetch(link, {
        redirect: 'error',
        headers: { Accept: 'text/html', 'User-Agent': 'EthioBingo/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }).then(async (res) => {
        if (!res.ok) throw new ReceiptError(`The receipt page returned HTTP ${res.status}.`, 'fetch_failed');
        const text = await res.text();
        if (text.length > MAX_BODY_BYTES) throw new ReceiptError('The receipt page is too large.', 'fetch_failed');
        return text;
      });
      parsed = parseTelebirrReceipt(html, target.reference);
    } else if (target.kind === 'cbe') {
      const apiUrl =
        target.url.includes('/api/v1/transactions/public/transaction-detail/') &&
        new URL(target.url).hostname === CBE_API_HOST
          ? target.url
          : `https://${CBE_API_HOST}/api/v1/transactions/public/transaction-detail/${encodeURIComponent(target.token)}`;
      const json = await doFetch(apiUrl, {
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'X-App-ID': CBE_APP_ID,
          'X-App-Version': CBE_APP_VERSION,
          'User-Agent': 'EthioBingo/1.0',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }).then(async (res) => {
        if (res.status === 404) throw new ReceiptError('CBE could not find this receipt.');
        if (!res.ok) throw new ReceiptError(`CBE returned HTTP ${res.status}.`, 'fetch_failed');
        const text = await res.text();
        if (text.length > MAX_BODY_BYTES) throw new ReceiptError('The receipt is too large.', 'fetch_failed');
        try {
          return JSON.parse(text);
        } catch {
          throw new ReceiptError('CBE returned an unreadable receipt.');
        }
      });
      parsed = parseCbeJson(json, target.reference);
    } else {
      const html = await doFetch(link, {
        redirect: 'error',
        headers: { Accept: 'text/html', 'User-Agent': 'EthioBingo/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }).then(async (res) => {
        if (!res.ok) throw new ReceiptError(`The receipt page returned HTTP ${res.status}.`, 'fetch_failed');
        const text = await res.text();
        if (text.length > MAX_BODY_BYTES) throw new ReceiptError('The receipt page is too large.', 'fetch_failed');
        return text;
      });
      parsed = parseCbeBirrReceipt(html, target.reference);
    }

    if (!parsed.reference) parsed.reference = target.reference;
    parsed.receiptUrl = link;
    parsed.reference = String(parsed.reference).trim();

    // A receipt paid to a different account is never credited; it goes to
    // admin review so the player can be told what happened.
    const verdict = receiverVerdict(parsed);
    if (!verdict.ok) return reviewResult(target, verdict.reason, parsed);

    if (parsed.currency !== 'ETB') {
      return reviewResult(target, `Receipt currency is ${parsed.currency}, not ETB.`, parsed);
    }
    if (!parsed.ok) {
      const reason =
        parsed.amountSantim <= 0
          ? 'Could not read the amount from this receipt.'
          : `The receipt status is "${parsed.status}", not completed.`;
      // Both cases often resolve on their own: a slow receipt page or a
      // payment that is still settling at the provider.
      return reviewResult(target, reason, parsed, target.url, true);
    }

    return {
      needsReview: false,
      reason: null,
      provider: parsed.provider,
      reference: parsed.reference,
      receiptUrl: link,
      parsed,
      retryable: false,
    };
  } catch (err) {
    if (err instanceof ReceiptError) {
      if (err.code === 'invalid_receipt') throw err;
      // Network/HTTP failures are transient; other errors are not.
      return reviewResult(target, err.message, null, target.url, err.code === 'fetch_failed');
    }
    // Anything unexpected here is almost always network/DNS/timeout related.
    return reviewResult(
      target,
      'The receipt could not be verified automatically.',
      null,
      target.url,
      true,
    );
  }
}

export function hashReceiptLink(link) {
  return `URL-${crypto.createHash('sha256').update(String(link)).digest('hex').slice(0, 20)}`;
}
