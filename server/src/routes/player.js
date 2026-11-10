import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { requirePlayer } from '../auth.js';
import { asyncHandler, AppError } from '../util.js';
import { getSettings } from '../settings.js';
import { getStateForUser, joinRound, claimBingo } from '../engine.js';
import { BANKS, requestWithdrawal, verifyDeposit } from '../wallet.js';
import { verifyReceiptDeposit } from '../receipt-deposits.js';
import { setSetting } from '../settings.js';
import { referralLinkFor } from './auth.js';

const router = Router();
router.use(requirePlayer);

const depositLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait a few minutes.' },
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const settings = getSettings();
    const agent = await prisma.agent.findUnique({ where: { userId: req.user.id } });
    const pendingWithdrawal = await prisma.withdrawal.findFirst({
      where: { userId: req.user.id, status: 'PENDING' },
    });
    const pendingDeposits = await prisma.deposit.count({
      where: { userId: req.user.id, status: 'PENDING_REVIEW' },
    });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const wins = await prisma.transaction.aggregate({
      where: { userId: req.user.id, type: 'win', status: 'completed', createdAt: { gte: startOfDay } },
      _sum: { amount: true },
    });
    res.json({
      winsToday: wins._sum.amount || 0,
      user: {
        id: req.user.id,
        telegramId: req.user.telegramId,
        username: req.user.username,
        firstName: req.user.firstName,
        phone: req.user.phone,
        balance: req.user.balance,
        derash: req.user.derash,
        role: req.user.role,
        isBanned: req.user.isBanned,
        hasPlayed: req.user.hasPlayed,
      },
      agent: agent
        ? {
            id: agent.id,
            referralCode: agent.referralCode,
            referralLink: referralLinkFor(agent.referralCode),
            commissionBalance: agent.commissionBalance,
          }
        : null,
      pendingWithdrawal,
      pendingDeposits,
      config: {
        stake: Number(settings.stake),
        minWithdraw: Number(settings.minWithdraw),
        maxAutoVerify: Number(settings.maxAutoVerify),
        platformFeeRate: Number(settings.platformFeeRate),
        voiceEnabled: Number(settings.voiceEnabled) !== 0,
        receiptAllowed: String(settings.receiptAllowed) === '1',
        receiptVerification: String(settings.receiptAllowed) === '1',
        smsEnabled: String(settings.smsAllowed) === '1',
        banks: BANKS,
      },
    });
  }),
);

router.get('/game/state', (req, res) => {
  res.json(getStateForUser(req.user.id));
});

router.post(
  '/game/join',
  asyncHandler(async (req, res) => {
    const result = await joinRound(req.user, req.body?.cards);
    res.json(result);
  }),
);

router.post(
  '/game/claim',
  asyncHandler(async (req, res) => {
    const result = await claimBingo(req.user);
    res.json(result);
  }),
);

router.get(
  '/game/history',
  asyncHandler(async (req, res) => {
    const rows = await prisma.gamePlayer.findMany({
      where: { userId: req.user.id },
      include: { game: true },
      orderBy: { id: 'desc' },
      take: 20,
    });
    res.json(
      rows.map((row) => ({
        id: row.id,
        gameId: row.gameId,
        stake: row.paidStake,
        isWinner: row.isWinner,
        winAmount: row.winAmount,
        playedAt: row.joinedAt,
        status: row.game.status,
      })),
    );
  }),
);

router.get(
  '/wallet/transactions',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await prisma.transaction.findMany({
      where: { userId: req.user.id },
      orderBy: { id: 'desc' },
      take: limit,
    });
    res.json(rows);
  }),
);

router.get(
  '/wallet/deposits',
  asyncHandler(async (req, res) => {
    const rows = await prisma.deposit.findMany({
      where: { userId: req.user.id },
      orderBy: { id: 'desc' },
      take: 20,
    });
    res.json(rows);
  }),
);

router.post(
  '/wallet/deposit/verify-link',
  depositLimiter,
  asyncHandler(async (req, res) => {
    if (String(getSettings().receiptAllowed) !== '1') {
      throw new AppError('Receipt verification is disabled on this server.', 503);
    }
    const link = String(req.body?.link || '').trim().slice(0, 2000);
    if (!link) throw new AppError('Paste the transaction link from your payment receipt.');
    const result = await verifyReceiptDeposit(req.user, link);
    res.json(result);
  }),
);

// Legacy SMS fallback, disabled unless ALLOW_SMS_VERIFICATION=true.
router.post(
  '/wallet/deposit/verify',
  depositLimiter,
  asyncHandler(async (req, res) => {
    const sms = String(req.body?.sms || '').slice(0, 4000);
    const expected = req.body?.amount ? Math.round(Number(req.body.amount) * 100) : null;
    if (!sms.trim()) throw new AppError('Paste the SMS message or enter a transaction number.');
    const result = await verifyDeposit(req.user, sms, Number.isFinite(expected) ? expected : null);
    res.json(result);
  }),
);

router.get(
  '/wallet/withdrawals',
  asyncHandler(async (req, res) => {
    const rows = await prisma.withdrawal.findMany({
      where: { userId: req.user.id },
      orderBy: { id: 'desc' },
      take: 20,
    });
    res.json(rows);
  }),
);

router.post(
  '/wallet/withdrawals',
  asyncHandler(async (req, res) => {
    const amountSantim = Math.round(Number(req.body?.amount) * 100);
    const result = await requestWithdrawal(req.user, {
      amountSantim,
      bank: req.body?.bank,
      accountNumber: req.body?.accountNumber,
      accountName: req.body?.accountName,
    });
    res.json(result);
  }),
);

router.get(
  '/my-referral',
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({ where: { userId: req.user.id } });
    if (!agent) throw new AppError('You are not an agent yet.', 404);
    res.json({
      referralCode: agent.referralCode,
      referralLink: referralLinkFor(agent.referralCode),
      commissionBalance: agent.commissionBalance,
      activeReferralCount: agent.activeReferralCount,
    });
  }),
);

export default router;
