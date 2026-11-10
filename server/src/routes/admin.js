import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { prisma } from '../db.js';
import { requireStaff } from '../auth.js';
import { asyncHandler, AppError } from '../util.js';
import { adminOverview, exportCsv, phoneStatusWhere } from '../analytics.js';
import { getSettings, updateSettings } from '../settings.js';
import { adminRoundDetails, startRoundNow } from '../engine.js';
import {
  adjustBalance,
  approveAgentWithdrawal,
  approveDeposit,
  approveWithdrawal,
  rejectAgentWithdrawal,
  rejectDeposit,
  rejectWithdrawal,
} from '../wallet.js';
import { setSetting } from '../settings.js';
import { broadcastTelegram, requestPhoneFromUser } from '../telegram.js';
import { uniqueReferralCode } from '../agents.js';
import { referralLinkFor } from './auth.js';
import { VOICE_DIR } from '../paths.js';
import { maskName } from '../util.js';

const router = Router();
router.use(requireStaff('admin'));

fs.mkdirSync(VOICE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VOICE_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /audio\//i.test(file.mimetype) || /\.(mp3|ogg|wav|m4a|aac)$/i.test(file.originalname);
    cb(ok ? null : new AppError('Upload an audio file (mp3, ogg, wav, m4a).'), ok);
  },
});

const VOICE_LABELS = { bingo: 'Bingo!', game_start: 'Game starting' };

function money(value) {
  return Math.round(Number(value) * 100);
}

function parsePositive(value, name, { min = 1, max = 1e9 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AppError(`Invalid ${name}.`);
  }
  return n;
}

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(await adminOverview());
  }),
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const phoneStatus = String(req.query.phoneStatus || 'all').trim().toLowerCase();
    const filters = [];
    if (search) {
      filters.push({
        OR: [
          { username: { contains: search } },
          { firstName: { contains: search } },
          { telegramId: { contains: search } },
          { phone: { contains: search } },
        ],
      });
    }
    const phoneWhere = phoneStatusWhere(phoneStatus);
    if (phoneWhere) filters.push(phoneWhere);
    const where = filters.length ? { AND: filters } : {};
    const users = await prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 100,
      include: {
        agent: true,
        referredByAgent: { include: { user: { select: { firstName: true, username: true } } } },
      },
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId,
        username: u.username,
        firstName: u.firstName,
        phone: u.phone,
        balance: u.balance,
        derash: u.derash,
        role: u.role,
        isBanned: u.isBanned,
        hasPlayed: u.hasPlayed,
        createdAt: u.createdAt,
        agent: u.agent ? { id: u.agent.id, referralCode: u.agent.referralCode, isActive: u.agent.isActive } : null,
        referredBy: u.referredByAgent
          ? {
              agentId: u.referredByAgent.id,
              name: u.referredByAgent.user.firstName || u.referredByAgent.user.username,
              referralCode: u.referredByAgent.referralCode,
            }
          : null,
      })),
    );
  }),
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        transactions: { orderBy: { id: 'desc' }, take: 50 },
        withdrawals: { orderBy: { id: 'desc' }, take: 20 },
        deposits: { orderBy: { id: 'desc' }, take: 20 },
        gamePlayers: { include: { game: true }, orderBy: { id: 'desc' }, take: 20 },
        agent: true,
      },
    });
    if (!user) throw new AppError('User not found', 404);
    const referrals = await prisma.referral.findMany({
      where: { agentId: user.agent?.id || -1 },
      include: { user: { select: { id: true, firstName: true, username: true, hasPlayed: true, createdAt: true } } },
      take: 100,
    });
    res.json({ user, referrals });
  }),
);

router.post(
  '/users/:id/adjust',
  asyncHandler(async (req, res) => {
    const amount = money(req.body?.amount);
    const reason = String(req.body?.reason || '').slice(0, 300);
    if (!reason) throw new AppError('A reason is required for balance adjustments.');
    const result = await adjustBalance(Number(req.params.id), amount, req.staff.sid, reason);
    res.json(result);
  }),
);

router.post(
  '/users/:id/ban',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const banned = Boolean(req.body?.banned);
    const user = await prisma.user.update({ where: { id }, data: { isBanned: banned } });
    await prisma.adminAction.create({
      data: { staffId: req.staff.sid, actionType: banned ? 'user_ban' : 'user_unban', details: `user:${id}` },
    });
    res.json({ ok: true, isBanned: user.isBanned });
  }),
);

router.post(
  '/users/:id/request-phone',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);
    if (user.phone) throw new AppError('This player already registered a phone number.');
    if (!/^-?\d+$/.test(String(user.telegramId || ''))) {
      throw new AppError('This player has no Telegram chat to message.');
    }
    const result = await requestPhoneFromUser(user.telegramId);
    await prisma.adminAction.create({
      data: {
        staffId: req.staff.sid,
        actionType: 'phone_request',
        details: JSON.stringify({ userId: id, simulated: result.simulated }),
      },
    });
    res.json(result);
  }),
);

router.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '').toUpperCase();
    const rows = await prisma.withdrawal.findMany({
      where: status ? { status } : {},
      include: { user: { select: { id: true, firstName: true, username: true, telegramId: true, balance: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(rows);
  }),
);

router.post(
  '/withdrawals/:id/approve',
  asyncHandler(async (req, res) => {
    res.json(await approveWithdrawal(Number(req.params.id), req.staff.sid, req.body?.notes || null));
  }),
);

router.post(
  '/withdrawals/:id/reject',
  asyncHandler(async (req, res) => {
    const notes = String(req.body?.notes || '').slice(0, 300);
    if (!notes) throw new AppError('Add a note explaining the rejection.');
    res.json(await rejectWithdrawal(Number(req.params.id), req.staff.sid, notes));
  }),
);

router.get(
  '/deposits',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || 'PENDING_REVIEW').toUpperCase();
    const rows = await prisma.deposit.findMany({
      where: status === 'ALL' ? {} : { status },
      include: { user: { select: { id: true, firstName: true, username: true, telegramId: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(rows);
  }),
);

router.post(
  '/deposits/:id/approve',
  asyncHandler(async (req, res) => {
    const override = req.body?.amount ? money(req.body.amount) : null;
    res.json(await approveDeposit(Number(req.params.id), req.staff.sid, override));
  }),
);

router.get(
  '/deposits/statuses',
  asyncHandler(async (_req, res) => {
    const statuses = await prisma.deposit.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    res.json(Object.fromEntries(statuses.map((s) => [s.status, s._count.id])));
  }),
);

router.post(
  '/deposits/:id/reject',
  asyncHandler(async (req, res) => {
    res.json(await rejectDeposit(Number(req.params.id), req.staff.sid, req.body?.notes));
  }),
);

router.get(
  '/agents',
  asyncHandler(async (_req, res) => {
    const agents = await prisma.agent.findMany({
      include: {
        user: { select: { id: true, firstName: true, username: true, telegramId: true, isBanned: true } },
        withdrawals: { where: { status: 'PENDING' } },
        _count: { select: { referrals: true } },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(
      agents.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.user?.firstName || a.user?.username,
        telegramId: a.user?.telegramId,
        userBanned: a.user?.isBanned,
        referralCode: a.referralCode,
        referralLink: referralLinkFor(a.referralCode),
        commissionBalance: a.commissionBalance,
        totalEarned: a.totalEarned,
        activeReferralCount: a.activeReferralCount,
        activityBonusPaid: a.activityBonusPaid,
        isActive: a.isActive,
        referralCount: a._count.referrals,
        pendingWithdrawals: a.withdrawals.reduce((sum, w) => sum + w.amount, 0),
        createdAt: a.createdAt,
      })),
    );
  }),
);

router.get(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: { user: true, transactions: { orderBy: { id: 'desc' }, take: 100 } },
    });
    if (!agent) throw new AppError('Agent not found', 404);
    const referrals = await prisma.referral.findMany({
      where: { agentId: id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            username: true,
            hasPlayed: true,
            createdAt: true,
            referredByAgentId: true,
          },
        },
      },
    });
    const userIds = referrals.map((r) => r.userId);
    const deposits = await prisma.transaction.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'deposit', status: 'completed' },
      _sum: { amount: true },
    });
    const games = await prisma.gamePlayer.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _count: { gameId: true },
    });
    const commissions = await prisma.agentTransaction.groupBy({
      by: ['referenceUserId'],
      where: { agentId: id, referenceUserId: { in: userIds } },
      _sum: { amount: true },
    });
    res.json({
      agent: { ...agent, referralLink: referralLinkFor(agent.referralCode) },
      referrals: referrals.map((r) => ({
        userId: r.userId,
        name: maskName(r.user.firstName || r.user.username),
        hasPlayed: r.user.hasPlayed,
        joinedAt: r.createdAt,
        totalDeposits: deposits.find((d) => d.userId === r.userId)?._sum.amount || 0,
        gamesPlayed: games.find((g) => g.userId === r.userId)?._count.gameId || 0,
        commissionEarned: commissions.find((c) => c.referenceUserId === r.userId)?._sum.amount || 0,
      })),
      withdrawals: await prisma.agentWithdrawal.findMany({ where: { agentId: id }, orderBy: { id: 'desc' } }),
    });
  }),
);

router.post(
  '/agents/promote',
  asyncHandler(async (req, res) => {
    const userId = Number(req.body?.userId);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!userId) throw new AppError('Select a user to promote.');
    if (!email.includes('@')) throw new AppError('Enter a valid login email for the agent.');
    if (password.length < 8) throw new AppError('Agent password must be at least 8 characters.');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const existingAgent = await prisma.agent.findUnique({ where: { userId } });
    if (existingAgent) throw new AppError('This user is already an agent.');

    const emailTaken = await prisma.staffAccount.findUnique({ where: { email } });
    if (emailTaken) throw new AppError('This login email is already in use.');

    const agent = await prisma.agent.create({
      data: { userId, referralCode: await uniqueReferralCode(user.firstName) },
    });
    await prisma.user.update({ where: { id: userId }, data: { role: 'agent' } });
    await prisma.staffAccount.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'agent',
        agentId: agent.id,
        name: user.firstName || user.username || `Agent ${agent.id}`,
      },
    });
    await prisma.adminAction.create({
      data: { staffId: req.staff.sid, actionType: 'agent_promote', details: `user:${userId} agent:${agent.id}` },
    });
    res.json({
      agent: { ...agent, referralLink: referralLinkFor(agent.referralCode) },
      login: { email, password },
    });
  }),
);

router.post(
  '/agents/:id/toggle',
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({ where: { id: Number(req.params.id) } });
    if (!agent) throw new AppError('Agent not found', 404);
    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { isActive: !agent.isActive },
    });
    await prisma.adminAction.create({
      data: {
        staffId: req.staff.sid,
        actionType: updated.isActive ? 'agent_enable' : 'agent_disable',
        details: `agent:${agent.id}`,
      },
    });
    res.json({ ok: true, isActive: updated.isActive });
  }),
);

router.post(
  '/agents/:id/adjust',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const amount = money(req.body?.amount);
    const reason = String(req.body?.reason || '').slice(0, 300);
    if (!amount) throw new AppError('Enter a non-zero amount.');
    if (!reason) throw new AppError('A reason is required.');
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new AppError('Agent not found', 404);
    if (agent.commissionBalance + amount < 0) throw new AppError('Adjustment would make the balance negative.');

    await prisma.$transaction([
      prisma.agent.update({
        where: { id },
        data: { commissionBalance: { increment: amount }, totalEarned: { increment: Math.max(0, amount) } },
      }),
      prisma.agentTransaction.create({
        data: { agentId: id, type: 'adjustment', amount, note: reason, status: 'completed' },
      }),
      prisma.adminAction.create({
        data: { staffId: req.staff.sid, actionType: 'agent_adjust', details: `agent:${id} amount:${amount} ${reason}` },
      }),
    ]);
    const updated = await prisma.agent.findUnique({ where: { id } });
    res.json({ ok: true, commissionBalance: updated.commissionBalance });
  }),
);

router.get(
  '/agent-withdrawals',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '').toUpperCase();
    const rows = await prisma.agentWithdrawal.findMany({
      where: status ? { status } : {},
      include: { agent: { include: { user: { select: { firstName: true, username: true, telegramId: true } } } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(rows);
  }),
);

router.post(
  '/agent-withdrawals/:id/approve',
  asyncHandler(async (req, res) => {
    res.json(await approveAgentWithdrawal(Number(req.params.id), req.staff.sid, req.body?.notes || null));
  }),
);

router.post(
  '/agent-withdrawals/:id/reject',
  asyncHandler(async (req, res) => {
    const notes = String(req.body?.notes || '').slice(0, 300);
    if (!notes) throw new AppError('Add a note explaining the rejection.');
    res.json(await rejectAgentWithdrawal(Number(req.params.id), req.staff.sid, notes));
  }),
);

router.get('/game/state', asyncHandler(async (_req, res) => res.json(await adminRoundDetails())));

router.post(
  '/game/start',
  asyncHandler(async (_req, res) => {
    await startRoundNow();
    res.json({ ok: true });
  }),
);

router.post(
  '/game/next-winner',
  asyncHandler(async (req, res) => {
    const type = String(req.body?.type || 'none');
    if (type === 'none') {
      await setSetting('nextWinner', 'none');
      await prisma.adminAction.create({
        data: { staffId: req.staff.sid, actionType: 'winner_override_clear', details: 'cleared' },
      });
      return res.json({ ok: true, nextWinner: null });
    }
    if (type === 'bot') {
      const name = String(req.body?.name || 'Lucky Bot').slice(0, 40);
      await setSetting('nextWinner', JSON.stringify({ type: 'bot', name }));
      await prisma.adminAction.create({
        data: { staffId: req.staff.sid, actionType: 'winner_override_set', details: `bot:${name}` },
      });
      return res.json({ ok: true, nextWinner: { type: 'bot', name } });
    }
    if (type === 'user') {
      const userId = Number(req.body?.userId);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError('Choose a valid player.');
      if (user.isBanned) throw new AppError('This user is banned.');
      await setSetting(
        'nextWinner',
        JSON.stringify({ type: 'user', userId, name: user.firstName || user.username || `User ${user.id}` }),
      );
      await prisma.adminAction.create({
        data: { staffId: req.staff.sid, actionType: 'winner_override_set', details: `user:${userId}` },
      });
      return res.json({ ok: true, nextWinner: { type: 'user', userId, name: user.firstName } });
    }
    throw new AppError('Invalid winner override type.');
  }),
);

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(getSettings());
  }),
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (body.stake !== undefined) patch.stake = String(Math.round(parsePositive(body.stake, 'stake', { min: 1, max: 100000 }) * 100));
    if (body.botCount !== undefined) patch.botCount = String(Math.round(parsePositive(body.botCount, 'bot count', { min: 0, max: 50 })));
    if (body.waitSeconds !== undefined) patch.waitSeconds = String(Math.round(parsePositive(body.waitSeconds, 'wait time', { min: 5, max: 300 })));
    if (body.callIntervalMs !== undefined) patch.callIntervalMs = String(Math.round(parsePositive(body.callIntervalMs, 'call interval', { min: 1000, max: 30000 })));
    if (body.roundEndDelayMs !== undefined) patch.roundEndDelayMs = String(Math.round(parsePositive(body.roundEndDelayMs, 'round end delay', { min: 2000, max: 60000 })));
    if (body.platformFeeRate !== undefined) patch.platformFeeRate = String(parsePositive(body.platformFeeRate, 'platform fee', { min: 0, max: 0.5 }));
    if (body.autoStart !== undefined) patch.autoStart = body.autoStart ? '1' : '0';
    if (body.voiceEnabled !== undefined) patch.voiceEnabled = body.voiceEnabled ? '1' : '0';
    if (body.minWithdraw !== undefined) patch.minWithdraw = String(Math.round(parsePositive(body.minWithdraw, 'minimum withdrawal', { min: 1, max: 100000 }) * 100));
    if (body.maxAutoVerify !== undefined) patch.maxAutoVerify = String(Math.round(parsePositive(body.maxAutoVerify, 'auto verify limit', { min: 1, max: 1000000 }) * 100));
    if (body.agentPer20Bonus !== undefined) patch.agentPer20Bonus = String(Math.round(parsePositive(body.agentPer20Bonus, 'deposit bonus', { min: 0, max: 1000 }) * 100));
    if (body.agentActivityBonus !== undefined) patch.agentActivityBonus = String(Math.round(parsePositive(body.agentActivityBonus, 'activity bonus', { min: 0, max: 1000 }) * 100));
    if (body.agentActivityThreshold !== undefined) patch.agentActivityThreshold = String(Math.round(parsePositive(body.agentActivityThreshold, 'activity threshold', { min: 1, max: 100 })));
    if (body.agentGameplayCommissionRate !== undefined) patch.agentGameplayCommissionRate = String(parsePositive(body.agentGameplayCommissionRate, 'gameplay commission', { min: 0, max: 1 }));
    if (body.agentMinWithdraw !== undefined) patch.agentMinWithdraw = String(Math.round(parsePositive(body.agentMinWithdraw, 'agent minimum withdrawal', { min: 1, max: 100000 }) * 100));
    if (body.receiptAllowed !== undefined) patch.receiptAllowed = body.receiptAllowed ? '1' : '0';
    if (body.smsAllowed !== undefined) patch.smsAllowed = body.smsAllowed ? '1' : '0';
    const updated = await updateSettings(patch, req.staff.sid);
    res.json(updated);
  }),
);

router.post(
  '/broadcast',
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const imageUrl = String(req.body?.imageUrl || '').trim();
    if (!text) throw new AppError('Write the ad message first.');
    if (text.length > 4000) throw new AppError('Message is too long (max 4000 characters).');
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      throw new AppError('Image URL must start with http:// or https://.');
    }
    res.json(await broadcastTelegram(text, req.staff.sid, imageUrl || null));
  }),
);

router.get(
  '/voice',
  asyncHandler(async (_req, res) => {
    const files = await prisma.voiceFile.findMany({ orderBy: { key: 'asc' } });
    res.json(files);
  }),
);

router.post(
  '/voice',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Choose an audio file to upload.');
    const number = req.body?.number ? Number(req.body.number) : null;
    const customKey = String(req.body?.key || '').trim();

    let key;
    let label;
    if (number) {
      if (!Number.isInteger(number) || number < 1 || number > 75) {
        fs.unlinkSync(req.file.path);
        throw new AppError('Number must be between 1 and 75.');
      }
      key = `num_${number}`;
      label = `Number ${number}`;
    } else if (VOICE_LABELS[customKey]) {
      key = customKey;
      label = VOICE_LABELS[customKey];
    } else {
      fs.unlinkSync(req.file.path);
      throw new AppError('Choose a number (1-75) or an announcement type.');
    }

    const fileUrl = `/uploads/voice/${req.file.filename}`;
    const existing = await prisma.voiceFile.findUnique({ where: { key } });
    const file = await prisma.voiceFile.upsert({
      where: { key },
      update: { fileUrl, isActive: true, number, label },
      create: { key, fileUrl, number, label, isActive: true },
    });
    if (existing?.fileUrl) {
      const oldPath = path.join(VOICE_DIR, path.basename(existing.fileUrl));
      fs.promises.unlink(oldPath).catch(() => {});
    }
    await prisma.adminAction.create({
      data: { staffId: req.staff.sid, actionType: 'voice_upload', details: key },
    });
    res.json(file);
  }),
);

router.delete(
  '/voice/:id',
  asyncHandler(async (req, res) => {
    const file = await prisma.voiceFile.findUnique({ where: { id: Number(req.params.id) } });
    if (!file) throw new AppError('Voice file not found', 404);
    await prisma.voiceFile.delete({ where: { id: file.id } });
    if (file.fileUrl) {
      fs.promises.unlink(path.join(VOICE_DIR, path.basename(file.fileUrl))).catch(() => {});
    }
    await prisma.adminAction.create({
      data: { staffId: req.staff.sid, actionType: 'voice_delete', details: file.key },
    });
    res.json({ ok: true });
  }),
);

router.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.adminAction.findMany({ orderBy: { id: 'desc' }, take: 100 });
    res.json(rows);
  }),
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || 'users');
    const csv = await exportCsv(type, { phoneStatus: req.query.phoneStatus });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }),
);

export default router;
