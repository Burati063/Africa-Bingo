import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReceiptLink, classifyReceiptLink, parseAmountSantim } from '../src/receipts.js';
import { verifyReceiptLink } from '../src/receipts.js';

function fakeFetch(body) {
  return async (url, opts) => {
    if (/api\/transaction-detail/.test(url)) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(body))) },
      });
    }
    const text = typeof body === 'string' ? body : body.html;
    return new Response(text, {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(text)) },
    });
  };
}

test('extracts a Telebirr receipt link and its reference', () => {
  const link = extractReceiptLink(
    'https://transactioninfo.ethiotelecom.et/receipt/CHQ0FJ403O',
  );
  assert.equal(link, 'https://transactioninfo.ethiotelecom.et/receipt/CHQ0FJ403O');
});

test('classifies CBE short and PDF links', () => {
  assert.equal(classifyReceiptLink('https://mbreciept.cbe.com.et/ab12CD34').kind, 'cbe');
  assert.equal(classifyReceiptLink('https://apps.cbe.com.et/receipt/a-b-c.pdf').kind, 'cbe-pdf');
});

test('parses a sample Telebirr bilingual receipt', async () => {
  const html = `
    <table>
      <tr><td>የክፍያው ሁኔታ/Transaction Status</td><td>Completed</td></tr>
      <tr><td>የተከፈለው መጠን/Settled Amount</td><td>ETB 100.00</td></tr>
      <tr><td>የገንዘብ ተቀባይ ቴሌብር ቁ/Credited party account no</td><td>0972449537</td></tr>
      <tr><td>የከፋይ ስም/Payer Name</td><td>Leul</td></tr>
    </table>
  `.replace(/\s+/g, ' ').trim();
  const result = await verifyReceiptLink('https://transactioninfo.ethiotelecom.et/receipt/CHQ0FJ403O', {
    fetchImpl: fakeFetch(html),
  });
  assert.equal(result.provider, 'telebirr');
  assert.equal(result.needsReview, false);
  assert.equal(result.parsed.amountSantim, 10000);
  assert.equal(result.parsed.receiverAccount, '0972449537');
  assert.equal(result.parsed.ok, true);
});

test('sends a receipt paid to a different account to review', async () => {
  process.env.DEPOSIT_TELEBIRR_ACCOUNT = '0972449537';
  process.env.DEPOSIT_TELEBIRR_NAME = 'Leul';
  const html = `
    <table>
      <tr><td>የክፍያው ሁኔታ/Transaction Status</td><td>Completed</td></tr>
      <tr><td>የተከፈለው መጠን/Settled Amount</td><td>ETB 100.00</td></tr>
      <tr><td>የገንዘብ ተቀባይ ቴሌብር ቁ/Credited party account no</td><td>0972000000000</td></tr>
    </table>
  `.replace(/\s+/g, ' ').trim();
  const result = await verifyReceiptLink(
    'https://transactioninfo.ethiotelecom.et/receipt/CHQ0FJ403O',
    { fetchImpl: fakeFetch(html) },
  );
  assert.equal(result.needsReview, true);
});

test('extracts a bare Telebirr transaction number', () => {
  assert.equal(extractReceiptLink('CIM220JG60'), 'https://transactioninfo.ethiotelecom.et/receipt/CIM220JG60');
});

test('parses a CBE birr receipt page', async () => {
  const html = `
    <table>
      <tr><td>Transaction Status</td><td>Completed</td></tr>
      <tr><td>Amount</td><td>ETB 50.00</td></tr>
      <tr><td>Credited Party</td><td>SILMA</td></tr>
    </table>
  `.replace(/\s+/g, ' ').trim();
  const result = await verifyReceiptLink(
    'https://cbepay1.cbe.com.et/aureceipt?TID=CBEB12345678&PH=0987654321',
    { fetchImpl: fakeFetch(html) },
  );
  assert.equal(result.provider, 'cbebirr');
  assert.equal(result.parsed.amountSantim, 5000);
});
