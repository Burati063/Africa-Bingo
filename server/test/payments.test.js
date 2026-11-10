import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentSms } from '../src/payments.js';
import { generateCard, hasLine, winningLines } from '../src/bingo.js';

test('parses a Telebirr transfer SMS', () => {
  const result = parsePaymentSms(
    'You have transferred ETB 100.00 to 0972449537 (Leul). Transaction number is CIM220JG60. Your balance is ETB 250.00.',
  );
  assert.equal(result.provider, 'telebirr');
  assert.equal(result.amountSantim, 10000);
  assert.equal(result.txRef, 'CIM220JG60');
});

test('parses a CBE transfer SMS with a transaction ID', () => {
  const result = parsePaymentSms(
    'Dear customer, ETB 250.50 has been debited from your account. Transaction ID: FT23070ABCD12. Thank you for banking with CBE.',
  );
  assert.equal(result.provider, 'cbe');
  assert.equal(result.amountSantim, 25050);
  assert.equal(result.txRef, 'FT23070ABCD12');
});

test('accepts a bare transaction number', () => {
  const result = parsePaymentSms('CIM220JG60');
  assert.equal(result.txRef, 'CIM220JG60');
  assert.equal(result.amountSantim, null);
});

test('rejects unrelated text', () => {
  const result = parsePaymentSms('hello there, how are you');
  assert.ok(result.error);
});

test('card has a free center and correct column range', () => {
  const card = generateCard();
  assert.equal(card.length, 5);
  assert.equal(card[2][2], 0);
  assert.ok(card[0].every((n) => n >= 1 && n <= 15));
  assert.ok(card[4].every((n) => n >= 61 && n <= 75));
  assert.equal(winningLines().length, 12);
});

test('detects a completed row', () => {
  const card = generateCard();
  const called = new Set(card.map((column) => column[0]).filter((n) => n !== 0));
  assert.equal(hasLine(card, called), true);
  assert.equal(hasLine(card, new Set()), false);
});
