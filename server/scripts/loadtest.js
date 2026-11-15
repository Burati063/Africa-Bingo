import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

// Socket-level concurrency test for the Telegram Mini App. It signs player
// tokens locally (no login rate limit, no database rows) and opens real
// WebSocket connections, then measures connect success and state broadcasts.
//
//   cd server
//   npm run loadtest -- --players 500 --duration 60 --base https://bingo.yourdomain.com
//
// Run it against staging, not while real players are in a paid round.

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const base = String(arg('base', process.env.BASE_URL || 'http://localhost:4000')).replace(/\/$/, '');
const players = Math.max(1, Math.floor(Number(arg('players', 500))));
const durationSec = Math.max(5, Math.floor(Number(arg('duration', 60))));
const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('[load] JWT_SECRET is required. Run from server/ with a filled .env.');
  process.exit(1);
}

const sockets = [];
const stats = { connected: 0, failed: 0, states: 0, connectMs: [] };

function connectOne(index) {
  const token = jwt.sign({ kind: 'player', uid: -100000 - index }, secret, { expiresIn: '10m' });
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = io(base, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 15000,
    });
    sockets.push(socket);

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (ok) {
        stats.connected += 1;
        stats.connectMs.push(Date.now() - started);
      } else {
        stats.failed += 1;
      }
      resolve();
    };

    socket.on('state', () => {
      stats.states += 1;
    });
    socket.once('connect', () => finish(true));
    socket.once('connect_error', (err) => {
      if (stats.failed < 5) console.error(`\n[load] #${index} ${err.message}`);
      finish(false);
    });
    setTimeout(() => {
      if (!socket.connected) {
        socket.close();
        finish(false);
      }
    }, 16000);
  });
}

console.log(`[load] ${players} players -> ${base} for ${durationSec}s`);
const startedAt = Date.now();

// Open in batches of 50 so the test machine's sockets are not the bottleneck.
for (let i = 0; i < players; i += 50) {
  const batch = Math.min(50, players - i);
  await Promise.all(Array.from({ length: batch }, (_, k) => connectOne(i + k + 1)));
  process.stdout.write(`\r[load] connected=${stats.connected} failed=${stats.failed}   `);
}

const connectMs = stats.connectMs.sort((a, b) => a - b);
const avg = connectMs.length ? Math.round(connectMs.reduce((sum, ms) => sum + ms, 0) / connectMs.length) : 0;
const p95 = connectMs.length ? connectMs[Math.min(connectMs.length - 1, Math.floor(connectMs.length * 0.95))] : 0;
const connectSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n[load] connected ${stats.connected}/${players} in ${connectSeconds}s (avg ${avg}ms, p95 ${p95}ms)`);

let lastStates = stats.states;
const interval = setInterval(() => {
  const now = stats.states;
  process.stdout.write(`\r[load] live=${stats.connected} states/s=${now - lastStates} total=${now}   `);
  lastStates = now;
}, 1000);

await new Promise((resolve) => setTimeout(resolve, durationSec * 1000));
clearInterval(interval);

const perPlayer = stats.states / Math.max(1, stats.connected);
console.log(`\n[load] state messages=${stats.states} (~${perPlayer.toFixed(1)} per connected player over ${durationSec}s)`);

for (const socket of sockets) socket.disconnect();
await new Promise((resolve) => setTimeout(resolve, 500));

const healthy = stats.connected >= Math.ceil(players * 0.98) && perPlayer >= durationSec * 0.5;
console.log(healthy ? '[load] PASS — 500+ socket capacity looks healthy' : '[load] FAIL — check server CPU, file limits and logs');
process.exit(healthy ? 0 : 1);
