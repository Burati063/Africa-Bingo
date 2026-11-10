import { Router } from 'express';
import { prisma } from '../db.js';
import { requireStaff } from '../auth.js';
import { asyncHandler, AppError, maskName } from '../util.js';
import { getSettings } from '../settings.js';
import { BANKS, requestAgentWithdrawal } from '../wallet.js';
import { referralLinkFor } from './auth.js';

const router = Router();
router.use(requireStaff('agent'));

async function currentAgent(req) {
  if (!req.staff.aid) throw new AppError('Not an agent account', 403);
  const agent = await prisma.agent.findUnique({
    where: { id: req.staff.aid },
    include: { user: { select: { id: true, firstName: true, username: true, telegramId: true } } },
  });
  if (!agent) throw new AppError('Agent not found', 404);
  if (!agent.isActive) throw new AppError('This agent account is disabled.', 403);
  return agent;
}

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const agent = await currentAgent(req);
    const settings = getSettings();
    const [referralCount, pending, commissions] = await Promise.all([
      prisma.referral.count({ where: { agentId: agent.id } }),
      prisma.agentWithdrawal.aggregate({ where: { agentId: agent.id, status: 'PENDING' }, _sum: { amount: true } }),
      prisma.agentTransaction.aggregate({
        where: { agentId: agent.id, status: 'completed', amount: { gt: 0 } },
        _sum: { amount: true },
      }),
    ]);
    res.json({
      agent: {
        id: agent.id,
        name: agent.user?.firstName || agent.user?.username,
        referralCode: agent.referralCode,
        referralLink: referralLinkFor(agent.referralCode),
        commissionBalance: agent.commissionBalance,
        totalEarned: agent.totalEarned,
        activeReferralCount: agent.activeReferralCount,
        activityBonusPaid: agent.activityBonusPaid,
        isActive: agent.isActive,
      },
      stats: {
        referralCount,
        totalCommission: commissions._sum.amount || 0,
        pendingWithdrawals: pending._sum.amount || 0,
      },
      config: {
        minWithdraw: Number(settings.agentMinWithdraw),
        per20Bonus: Number(settings.agentPer20Bonus),
        activityBonus: Number(settings.agentActivityBonus),
        activityThreshold: Number(settings.agentActivityThreshold),
        gameplayRate: Number(settings.agentGameplayCommissionRate),
        platformFeeRate: Number(settings.platformFeeRate),
        banks: BANKS,
      },
    });
  }),
);

router.get(
  '/referrals',
  asyncHandler(async (req, res) => {
    const agent = await currentAgent(req);
    const referrals = await prisma.referral.findMany({
      where: { agentId: agent.id },
      include: { user: { select: { id: true, firstName: true, username: true, hasPlayed: true, createdAt: true } } },
      orderBy: { id: 'desc' },
    });
    const userIds = referrals.map((r) => r.userId);
    const [deposits, games, commissions] = await Promise.all([
      prisma.transaction.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, type: 'deposit', status: 'completed' },
        _sum: { amount: true },
      }),
      prisma.gamePlayer.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { gameId: true },
      }),
      prisma.agentTransaction.groupBy({
        by: ['referenceUserId'],
        where: { agentId: agent.id, referenceUserId: { in: userIds } },
        _sum: { amount: true },
      }),
    ]);
    res.json(
      referrals.map((r) => ({
        userId: r.userId,
        name: maskName(r.user.firstName || r.user.username),
        joinedAt: r.createdAt,
        active: r.user.hasPlayed,
        totalDeposits: deposits.find((d) => d.userId === r.userId)?._sum.amount || 0,
        gamesPlayed: games.find((g) => g.userId === r.userId)?._count.gameId || 0,
        commissionEarned: commissions.find((c) => c.referenceUserId === r.userId)?._sum.amount || 0,
      })),
    );
  }),
);

router.get(
  '/earnings',
  asyncHandler(async (req, res) => {
    const agent = await currentAgent(req);
    const rows = await prisma.agentTransaction.findMany({
      where: { agentId: agent.id },
      include: { referenceUser: { select: { firstName: true, username: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        status: row.status,
        note: row.note,
        sourceUser: row.referenceUser ? maskName(row.referenceUser.firstName || row.referenceUser.username) : null,
        createdAt: row.createdAt,
      })),
    );
  }),
);

router.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const agent = await currentAgent(req);
    const rows = await prisma.agentWithdrawal.findMany({
      where: { agentId: agent.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    res.json(rows);
  }),
);

router.post(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const agent = await currentAgent(req);
    const amountSantim = Math.round(Number(req.body?.amount) * 100);
    const withdrawal = await requestAgentWithdrawal(agent, {
      amountSantim,
      bank: req.body?.bank,
      accountNumber: req.body?.accountNumber,
      accountName: req.body?.accountName,
    });
    res.json(withdrawal);
  }),
);

export default router;
