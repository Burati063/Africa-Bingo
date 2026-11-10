import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depositBonusSantim,
  gameplayCommissionSantim,
  makeReferralCode,
  shouldPayActivityBonus,
} from '../src/agents.js';

test('deposit bonus: 1 ETB per 20 ETB, zero below floor', () => {
  assert.equal(depositBonusSantim(1999), 0);
  assert.equal(depositBonusSantim(2000), 100);
  assert.equal(depositBonusSantim(3999), 100);
  assert.equal(depositBonusSantim(4000), 200);
});

test('gameplay commission: 5% of the 20% platform fee on referred stakes', () => {
  // Platform fee = 20% of stake. Commission = 5% of that fee.
  assert.equal(gameplayCommissionSantim({ platformFee: 200, referredStake: 4000 }), 40);
  assert.equal(gameplayCommissionSantim({ platformFee: 0, referredStake: 0 }), 0);
});

test('3 ETB activity bonus is paid once, at the third active referral', () => {
  const third = shouldPayActivityBonus({ activeReferralCount: 3, activityBonusPaid: false, threshold: 3 });
  assert.equal(third, true);

  // Not before the threshold.
  assert.equal(
    shouldPayActivityBonus({ activeReferralCount: 2, activityBonusPaid: false, threshold: 3 }),
    false,
  );

  // Never twice, even with more referrals.
  assert.equal(
    shouldPayActivityBonus({ activeReferralCount: 9, activityBonusPaid: true, threshold: 3 }),
    false,
  );
});

test('referral codes are uppercase, short and prefixed by the name', () => {
  const code = makeReferralCode('Selam');
  assert.match(code, /^SELA[0-9A-Z]{5}$/);
  assert.match(makeReferralCode(null), /^AG[0-9A-Z]{5}$/);
});
