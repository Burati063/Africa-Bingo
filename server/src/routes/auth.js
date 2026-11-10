import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { asyncHandler, AppError } from '../util.js';
import {
  authConfig,
  resolveIdentity,
  signPlayer,
  signStaff,
  startParamFromInitData,
  requireStaff,
} from '../auth.js';
import { linkReferral } from '../agents.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ብዙ የመግቢያ ሙከራዎች። ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ።' },
});

function publicUser(user) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    phone: user.phone,
    balance: user.balance,
    derash: user.derash,
    role: user.role,
    referredByAgentId: user.referredByAgentId,
    hasPlayed: user.hasPlayed,
    isBanned: user.isBanned,
  };
}

export function referralLinkFor(code) {
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  const base = process.env.PUBLIC_URL || 'http://localhost:5173';
  if (bot) return `https://t.me/${bot.replace(/^@/, '')}?start=${code}`;
  return `${base}?start=${code}`;
}

router.post(
  '/telegram',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { initData, startParam, devTelegramId, devFirstName, devUsername } = req.body || {};
    if (req.user?.isBanned) throw new AppError('ይህ መለያ ታግዷል።', 403);

    const identity = resolveIdentity({ initData, startParam, devTelegramId, devFirstName, devUsername });

    let user = await prisma.user.findUnique({ where: { telegramId: identity.telegramId } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: identity.telegramId,
          firstName: identity.firstName || 'Player',
          username: identity.username || null,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: identity.firstName || user.firstName,
          username: identity.username || user.username,
        },
      });
    }

    if (user.isBanned) throw new AppError('ይህ መለያ ታግዷል።', 403);

    const code = startParam || startParamFromInitData(initData);
    if (code && !user.referredByAgentId) {
      await linkReferral(user, code);
      user = await prisma.user.findUnique({ where: { id: user.id } });
    }

    const agent = await prisma.agent.findUnique({ where: { userId: user.id } });
    res.json({
      token: signPlayer(user.id),
      user: publicUser(user),
      agent: agent
        ? { id: agent.id, referralCode: agent.referralCode, referralLink: referralLinkFor(agent.referralCode) }
        : null,
      telegramVerified: identity.verified,
      devMode: authConfig.DEV_MODE,
    });
  }),
);

router.post(
  '/staff/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw new AppError('Email and password are required.');

    const account = await prisma.staffAccount.findUnique({ where: { email }, include: { agent: true } });
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
      throw new AppError('Wrong email or password.', 401);
    }

    if (account.role === 'agent' && account.agent && !account.agent.isActive) {
      throw new AppError('This agent account is disabled.', 403);
    }

    res.json({
      token: signStaff(account),
      account: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        agentId: account.agentId,
        referralCode: account.agent?.referralCode || null,
      },
    });
  }),
);

router.get(
  '/staff/me',
  requireStaff(),
  asyncHandler(async (req, res) => {
    const account = await prisma.staffAccount.findUnique({
      where: { id: req.staff.sid },
      include: { agent: { include: { user: true } } },
    });
    if (!account) throw new AppError('Unauthorized', 401);
    res.json({
      account: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        agentId: account.agentId,
      },
      agent: account.agent
        ? {
            id: account.agent.id,
            referralCode: account.agent.referralCode,
            referralLink: referralLinkFor(account.agent.referralCode),
            commissionBalance: account.agent.commissionBalance,
          }
        : null,
    });
  }),
);

export default router;
