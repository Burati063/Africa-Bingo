import { prisma } from './db.js';
import { getSettings } from './settings.js';
import { emitToUser } from './realtime.js';

export function makeReferralCode(firstName) {
  const base = String(firstName || 'AG')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'AG';
  return `${base}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export async function uniqueReferralCode(firstName) {
  for (let i = 0; i < 10; i += 1) {
    const code = makeReferralCode(firstName);
    const exists = await prisma.agent.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  return `AG${Date.now().toString(36).toUpperCase()}`;
}

/** Promote a user to agent. The referral code is permanent; attribution of
 * referred users is stored on the user row and never overwritten. */
export async function createAgentForUser(user, staffId = null) {
  const existing = await prisma.agent.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const referralCode = await uniqueReferralCode(user.firstName);
  const agent = await prisma.agent.create({
    data: { userId: user.id, referralCode },
  });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'agent' } });
  if (staffId) {
    await prisma.adminAction.create({
      data: { staffId, actionType: 'agent_promote', details: `user:${user.id} code:${referralCode}` },
    });
  }
  return agent;
}

export async function linkReferral(user, rawCode) {
  if (!rawCode || user.referredByAgentId) return null;
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return null;
  const agent = await prisma.agent.findUnique({ where: { referralCode: code }, include: { user: true } });
  if (!agent || !agent.isActive) return null;
  if (agent.userId === user.id) return null; // self-referral guard
  if (!agent.user || agent.user.isBanned) return null;

  const already = await prisma.referral.findUnique({ where: { userId: user.id } });
  if (already) return null;

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { referredByAgentId: agent.id } }),
    prisma.referral.create({ data: { agentId: agent.id, userId: user.id } }),
  ]);
  return agent;
}

async function creditAgent(agentId, type, amountSantim, referenceUserId = null, note = null) {
  if (amountSantim <= 0) return null;
  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: {
      commissionBalance: { increment: amountSantim },
      totalEarned: { increment: amountSantim },
    },
  });
  await prisma.agentTransaction.create({
    data: { agentId, type, amount: amountSantim, referenceUserId, note },
  });
  // Keep a matching expense in the player ledger for full auditability.
  emitToUser(agent.userId, 'agent:balance', { commissionBalance: agent.commissionBalance });
  return agent;
}

/**
 * Deposit commission: 1 ETB for every 20 ETB deposited by a referred user
 * (rounded down). Applies to the first and all subsequent deposits.
 */
export async function onDepositVerified(userId, amountSantim) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.referredByAgentId) return null;
  const settings = getSettings();
  const step = 2000;
  const perStep = Number(settings.agentPer20Bonus);
  const bonus = Math.floor(amountSantim / step) * perStep;
  return creditAgent(user.referredByAgentId, 'deposit_bonus', bonus, userId, `Deposit of ${amountSantim / 100} ETB`);
}

/**
 * Called for every stake. Marks the referred user as active on their first
 * game, pays the one-time 3-active-user bonus, and pays the optional ongoing
 * share of the platform fee.
 */
export async function onStake(userId, stakeSantim) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const settings = getSettings();

  if (!user.hasPlayed) {
    await prisma.user.update({ where: { id: userId }, data: { hasPlayed: true } });
    if (user.referredByAgentId) {
      const agent = await prisma.agent.update({
        where: { id: user.referredByAgentId },
        data: { activeReferralCount: { increment: 1 } },
      });
      const threshold = Number(settings.agentActivityThreshold);
      if (shouldPayActivityBonus({
        activeReferralCount: agent.activeReferralCount,
        activityBonusPaid: agent.activityBonusPaid,
        threshold,
      })) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { activityBonusPaid: true },
        });
        await creditAgent(
          agent.id,
          'activity_bonus',
          Number(settings.agentActivityBonus),
          null,
          `${threshold} active referred players reached`,
        );
      }
    }
  }

  if (!user.referredByAgentId) return;
  const rate = Number(settings.agentGameplayCommissionRate);
  const feeRate = Number(settings.platformFeeRate);
  if (rate > 0) {
    const commission = Math.round(stakeSantim * feeRate * rate);
    if (commission > 0) {
      await creditAgent(
        user.referredByAgentId,
        'gameplay_commission',
        commission,
        userId,
        `Stake of ${stakeSantim / 100} ETB`,
      );
    }
  }
}

/** One-time bonus once enough referred players have each played a game. */
export function shouldPayActivityBonus({ activeReferralCount, activityBonusPaid, threshold }) {
  if (activityBonusPaid) return false;
  return Number(activeReferralCount) >= Math.max(1, Number(threshold) || 3);
}

export function depositBonusSantim(amountSantim) {
  const settings = getSettings();
  const step = 2000;
  const perStep = Number(settings.agentPer20Bonus);
  if (perStep <= 0) return 0;
  return Math.min(Math.floor(amountSantim / step) * perStep, Number(settings.maxAgentBonus || 5000));
}

export function gameplayCommissionSantim({ platformFee, referredStake }) {
  const settings = getSettings();
  const rate = Number(settings.agentGameplayCommissionRate);
  const feeRate = Number(settings.platformFeeRate);
  if (rate <= 0 || feeRate <= 0 || referredStake <= 0) return 0;
  return Math.round(referredStake * feeRate * rate);
}

export async function agentStats(agentId) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { user: true } });
  if (!agent) return null;
  const [referrals, commissions, pending] = await Promise.all([
    prisma.referral.count({ where: { agentId } }),
    prisma.agentTransaction.aggregate({
      where: { agentId, status: 'completed', amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.agentWithdrawal.aggregate({
      where: { agentId, status: 'PENDING' },
      _sum: { amount: true },
    }),
  ]);
  return {
    ...agent,
    referralCount: referrals,
    totalCommission: commissions._sum.amount || 0,
    pendingWithdrawals: pending._sum.amount || 0,
  };
}
