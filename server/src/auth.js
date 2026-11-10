import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { AppError } from './util.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const DEV_MODE = process.env.DEV_MODE !== 'false';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export function signPlayer(userId) {
  return jwt.sign({ kind: 'player', uid: userId }, SECRET, { expiresIn: '7d' });
}

export function signStaff(account) {
  return jwt.sign(
    { kind: 'staff', sid: account.id, role: account.role, aid: account.agentId || null },
    SECRET,
    { expiresIn: '12h' },
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function requirePlayer(req, res, next) {
  try {
    const payload = verifyToken(bearer(req));
    if (!payload || payload.kind !== 'player') throw new AppError('Unauthorized', 401);
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user) throw new AppError('Unauthorized', 401);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireStaff(role) {
  return (req, res, next) => {
    const payload = verifyToken(bearer(req));
    if (!payload || payload.kind !== 'staff') return next(new AppError('Unauthorized', 401));
    if (role && payload.role !== role) return next(new AppError('Forbidden', 403));
    req.staff = payload;
    next();
  };
}

/**
 * Telegram WebApp initData validation.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initData, botToken = BOT_TOKEN) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (authDate && Date.now() / 1000 - authDate > 60 * 60 * 24) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

/**
 * Resolve the Telegram identity of a login request. In development (or when no
 * bot token is configured) a dev identity can be supplied by the client.
 */
export function resolveIdentity({ initData, startParam, devTelegramId, devFirstName, devUsername }) {
  const tgUser = validateTelegramInitData(initData);
  if (tgUser) {
    return { telegramId: String(tgUser.id), firstName: tgUser.first_name, username: tgUser.username, verified: true };
  }
  if (!DEV_MODE) {
    if (BOT_TOKEN) throw new AppError('Invalid Telegram authentication data', 401);
    throw new AppError('Telegram authentication is not configured on this server', 503);
  }
  if (!devTelegramId) throw new AppError('Missing Telegram authentication data', 401);
  return {
    telegramId: String(devTelegramId).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 64) || 'dev-player',
    firstName: (devFirstName || 'Dev').slice(0, 64),
    username: devUsername ? String(devUsername).slice(0, 64) : null,
    verified: false,
  };
}

export function startParamFromInitData(initData) {
  if (!initData) return null;
  try {
    return new URLSearchParams(initData).get('start_param');
  } catch {
    return null;
  }
}

export const authConfig = { DEV_MODE, hasBotToken: Boolean(BOT_TOKEN) };
