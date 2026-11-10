/**
 * Telebirr / CBE payment SMS parsers.
 * Verification stays server-side: the client submits the raw SMS (or a bare
 * transaction number) and the backend extracts amount / reference. Providers do
 * not expose a public verification API for these wallets, so this is a
 * format-based verification with dedupe + manual review for large amounts.
 */
const TRANSFER_WORDS = /(transferred|transfer|paid|payment|deposit|received|debited|credited)/i;

const PROVIDER_HINTS = [
  { provider: 'telebirr', re: /telebirr/i },
  { provider: 'cbe', re: /(cbe|commercial bank of ethiopia|cbebirr)/i },
];

const AMOUNT_PATTERNS = [
  /(?:ETB|Birr|BR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr|BR)\b/i,
  /(?:amount|ብር)\s*[:=]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
];

const REF_PATTERNS = [
  /transaction\s*(?:number|no\.?|id)\s*(?:is|:|=)?\s*([A-Z0-9]{6,32})/i,
  /(?:txn|trx|ref(?:erence)?)\s*(?:number|no\.?|id)?\s*[:=]?\s*([A-Z0-9]{6,32})/i,
  /\b(FT[0-9A-Z]{8,24})\b/i,
  /\b(CIM[0-9A-Z]{5,24})\b/i,
];

const PHONE_PATTERNS = [
  /(?:from|sender|phone|account)\s*[:=]?\s*(\+?251[0-9]{9}|09[0-9]{8}|07[0-9]{8})/i,
  /(\+?251[0-9]{9})/,
  /(09[0-9]{8})/,
];

const DATE_PATTERNS = [
  /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/,
  /(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)/i,
  /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)/i,
];

function detectProvider(text) {
  for (const hint of PROVIDER_HINTS) {
    if (hint.re.test(text)) return hint.provider;
  }
  if (/\bCIM[0-9A-Z]{5,}\b/i.test(text)) return 'telebirr';
  if (/\bFT[0-9A-Z]{8,}\b/i.test(text)) return 'cbe';
  return 'unknown';
}

function extractAmount(text) {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) return Math.round(value * 100);
    }
  }
  return null;
}

function extractRef(text) {
  for (const pattern of REF_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function extractMatch(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function parsePaymentSms(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return { error: 'Paste the SMS message or a transaction number.' };

  // Bare transaction number: `CIM220JG60`
  const bare = raw.match(/^[A-Z0-9]{6,32}$/i);
  if (bare && !/\s/.test(raw)) {
    return {
      provider: detectProvider(raw),
      amountSantim: null,
      txRef: raw.toUpperCase(),
      sender: null,
      date: null,
      raw,
      bareRef: true,
    };
  }

  const compact = raw.replace(/\s+/g, ' ');
  const txRef = extractRef(compact);
  const amountSantim = extractAmount(compact);
  const provider = detectProvider(compact);

  if (!txRef && !TRANSFER_WORDS.test(compact)) {
    return { error: 'This does not look like a Telebirr or CBE payment message.' };
  }

  return {
    provider,
    amountSantim,
    txRef,
    sender: extractMatch(PHONE_PATTERNS, compact),
    date: extractMatch(DATE_PATTERNS, compact),
    raw,
    bareRef: false,
  };
}
