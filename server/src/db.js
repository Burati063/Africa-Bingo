import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// SQLite tuning for concurrent players. WAL lets readers continue while the
// game engine writes calls/stakes, and busy_timeout stops short write locks
// from turning into 500 errors. A single Node instance comfortably handles
// 500+ sockets with these settings; move to PostgreSQL when you add a second
// app instance or need multi-process writes.
if (String(process.env.DATABASE_URL || 'file:').startsWith('file:')) {
  const pragmas = [
    'PRAGMA journal_mode=WAL;',
    'PRAGMA synchronous=NORMAL;',
    'PRAGMA busy_timeout=8000;',
    'PRAGMA cache_size=-20000;',
    'PRAGMA temp_store=MEMORY;',
  ];
  for (const pragma of pragmas) {
    try {
      await prisma.$queryRawUnsafe(pragma);
    } catch (err) {
      console.warn(`[db] ${pragma} skipped: ${err.message}`);
    }
  }
}
