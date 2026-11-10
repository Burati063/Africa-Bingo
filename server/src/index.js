import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';
import { prisma } from './db.js';
import { authConfig, verifyToken } from './auth.js';
import { asyncHandler } from './util.js';
import { loadSettings } from './settings.js';
import { retryPendingReceiptDeposits } from './receipt-deposits.js';
import { setIO } from './realtime.js';
import { getPublicState, getStateForUser, startEngine } from './engine.js';
import { startTelegramBot, stopTelegramBot } from './telegram.js';
import { UPLOADS_DIR, WEB_DIST } from './paths.js';
import authRouter from './routes/auth.js';
import playerRouter from './routes/player.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';

const PORT = Number(process.env.PORT || 4000);
const corsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }),
);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get(
  '/api/voice-files',
  asyncHandler(async (_req, res) => {
    const files = await prisma.voiceFile.findMany({ where: { isActive: true }, orderBy: { key: 'asc' } });
    res.json(files);
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/agent', agentRouter);
app.use('/api', playerRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

const hasWebBuild = fs.existsSync(path.join(WEB_DIST, 'index.html'));
if (hasWebBuild) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    return res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: corsOrigins.length ? corsOrigins : true },
});
setIO(io);

io.use((socket, next) => {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload || payload.kind !== 'player') return next(new Error('unauthorized'));
  socket.data.userId = payload.uid;
  next();
});

io.on('connection', (socket) => {
  const { userId } = socket.data;
  socket.join(`user:${userId}`);
  socket.emit('state', getStateForUser(userId));
});

async function main() {
  await loadSettings();
  await startEngine();

  // Receipt pages lag behind the payment, so pending deposits are re-checked in
  // the background before an admin has to look at them.
  const retryTimer = setInterval(async () => {
    try {
      const result = await retryPendingReceiptDeposits({ limit: 10 });
      if (result.checked) {
        console.log(
          `[deposits] auto re-check: ${result.checked} checked, ${result.credited} credited, ${result.rescheduled} rescheduled, ${result.exhausted} to manual review`,
        );
      }
    } catch (err) {
      console.error('[deposits] auto re-check failed', err.message);
    }
  }, Math.max(10_000, Number(process.env.RECEIPT_RETRY_INTERVAL_MS || 60_000)));
  retryTimer.unref?.();

  startTelegramBot();

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] dev mode: ${authConfig.DEV_MODE}, telegram token: ${authConfig.hasBotToken ? 'set' : 'missing'}`);
    console.log(`[server] serving web build: ${hasWebBuild ? WEB_DIST : 'no (run npm run build)'}`);
  });
}

process.on('SIGINT', async () => {
  stopTelegramBot();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopTelegramBot();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

main().catch(async (err) => {
  console.error('[server] failed to start', err);
  await prisma.$disconnect();
  process.exit(1);
});

export { app, server, getPublicState };
