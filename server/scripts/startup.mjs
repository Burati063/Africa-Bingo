// Container entrypoint: wait for PostgreSQL, apply migrations, seed, then start
// the server.
//
// A managed database (Neon on Render) or the `db` container in a fresh compose
// stack can refuse connections for a few seconds after the app boots. Applying
// migrations once without retrying makes the container exit, and Render answers
// that with a restart loop instead of a working deploy.
//
// Tuning: STARTUP_MAX_ATTEMPTS (default 10), STARTUP_RETRY_BASE_MS (2000),
// STARTUP_RETRY_MAX_MS (30000).
import { spawn } from 'node:child_process';

const MAX_ATTEMPTS = Math.max(1, Number(process.env.STARTUP_MAX_ATTEMPTS || 10));
const BASE_DELAY_MS = Math.max(250, Number(process.env.STARTUP_RETRY_BASE_MS || 2000));
const MAX_DELAY_MS = Math.max(BASE_DELAY_MS, Number(process.env.STARTUP_RETRY_MAX_MS || 30000));
const INITIAL_MIGRATION = '20261115120000_init';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
    });
    // Prisma prints the useful part of a failure (for example P3005) to stderr,
    // so capture it when the caller needs to classify the error.
    let output = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
        process.stderr.write(chunk);
      });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      const error = new Error(`${command} ${args.join(' ')} exited with ${signal || code}`);
      error.output = output;
      reject(error);
    });
  });
}

async function withRetry(label, task, { isFatal } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await task();
      console.log(`[startup] ${label}: ok`);
      return;
    } catch (err) {
      if (isFatal?.(err)) {
        console.error(`[startup] ${label}: ${err.message}`);
        console.error(
          `[startup] this database already has tables but no migration history (it was created with ` +
            `\`prisma db push\`). Baseline it once, then restart:\n` +
            `[startup]   npx prisma migrate resolve --applied ${INITIAL_MIGRATION}`,
        );
        process.exit(1);
      }
      if (attempt >= MAX_ATTEMPTS) {
        console.error(`[startup] ${label} failed after ${attempt} attempts: ${err.message}`);
        process.exit(1);
      }
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
      console.warn(
        `[startup] ${label} attempt ${attempt} failed (${err.message}); retrying in ${delay} ms`,
      );
      await sleep(delay);
    }
  }
}

// P3005 = "database schema is not empty": a pre-migrations database, never transient.
await withRetry(
  'database migrations',
  () => run('npx', ['prisma', 'migrate', 'deploy'], { capture: true }),
  { isFatal: (err) => /P3005|schema is not empty/i.test(`${err.message}\n${err.output || ''}`) },
);
await withRetry('seed', () => run(process.execPath, ['prisma/seed.js']));

console.log('[startup] starting server');
try {
  await run(process.execPath, ['src/index.js']);
} catch (err) {
  console.error(`[startup] server stopped: ${err.message}`);
  process.exit(1);
}
