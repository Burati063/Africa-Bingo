import test from 'node:test';
import assert from 'node:assert/strict';
import { computePayout, totalRealStakes } from '../src/payouts.js';
import { cardHasBingo, generateCard, hasLine, winningLines } from '../src/bingo.js';

test('platform keeps 20% and the pool splits between real winners', () => {
  // 4 real players at 10 ETB: 4000 santim staked, 20% fee, one winner.
  const one = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 1 });
  assert.equal(one.platformFee, 800);
  assert.equal(one.pool, 3200);
  assert.equal(one.share, 3200);

  // Two real players share the same pool.
  const two = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 2 });
  assert.equal(two.pool, 3200);
  assert.equal(two.share, 1600);
});

test('bots winning means no payout and the pool stays whole', () => {
  const result = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 0 });
  assert.equal(result.pool, 3200);
  assert.equal(result.share, 0);
});

test('odd pools round down so the platform never pays more than it took', () => {
  const result = computePayout({ stakes: 3999, platformFeeRate: 0.2, realWinnerCount: 3 });
  assert.equal(result.pool, 3199);
  assert.equal(result.share, 1066);
  assert.ok(result.share * 3 <= result.pool);
});

test('only real stakes count towards the pot', () => {
  const players = [
    { isBot: false, paidStake: 1000 },
    { isBot: true, paidStake: 0 },
    { isBot: false, paidStake: 1000 },
  ];
  assert.equal(totalRealStakes(players), 2000);
});

test('a generated card has 12 ways to win and a free centre', () => {
  const card = generateCard();
  assert.equal(card.length, 5);
  assert.equal(card[2][2], 0);
  assert.equal(winningLines().length, 12);

  // A fresh card is not bingo yet.
  assert.equal(hasLine(card, new Set()), false);

  // Complete the top row.
  const called = new Set([card[0][0], card[1][0], card[2][0], card[3][0], card[4][0]]);
  assert.equal(hasLine(card, called), true);

  // Four of five in a row is not bingo.
  called.delete(card[4][0]);
  assert.equal(hasLine(card, called), false);
});

test('cardHasBingo checks every card the player holds', () => {
  const card = generateCard();
  const called = new Set([card[0][4], card[1][4], card[2][4], card[3][4], card[4][4]]);
  assert.equal(cardHasBingo([generateCard(), card], called), true);
  assert.equal(cardHasBingo([], called), false);
});
