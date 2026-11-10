import { prisma } from './db.js';

/**
 * Platform settings live in the database but are cached in memory for the
 * game loop (which reads them every tick). Update through updateSettings()
 * so the cache stays in sync.
 */
export const DEFAULT_SETTINGS = {
  stake: '2000', // 20 ETB entry fee
  botCount: '8',
  waitSeconds: '20',
  callIntervalMs: '3000',
  roundEndDelayMs: '8000',
  platformFeeRate: '0.2',
  autoStart: 'true',
  voiceEnabled: 'true',
  minWithdraw: '5000', // 50 ETB
  maxAutoVerify: '500000', // 5,000 ETB
  agentPer20Bonus: '100', // 1 ETB for every 20 ETB deposited
  agentActivityBonus: '300', // 3 ETB one-time bonus
  agentActivityThreshold: '3',
  agentGameplayCommissionRate: '0.05', // 5% of platform fee from referred users
  agentMinWithdraw: '5000', // 50 ETB
  nextWinner: 'none', // JSON override applied to the next round
  receiptAllowed: '1', // players may verify Telebirr / CBE receipt links
  smsAllowed: '0', // legacy SMS deposit parsing, off by default
};

let cache = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
  const rows = await prisma.platformSetting.findMany();
  const merged = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  cache = merged;
  return cache;
}

export function getSettings() {
  return cache;
}

export async function updateSettings(patch, staffId = null) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
  for (const [key, value] of entries) {
    const stringValue = String(value);
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue },
    });
    cache[key] = stringValue;
  }
  if (entries.length && staffId) {
    await prisma.adminAction.create({
      data: {
        staffId,
        actionType: 'settings_update',
        details: JSON.stringify(Object.fromEntries(entries)),
      },
    });
  }
  return cache;
}

export async function setSetting(key, value) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
  cache[key] = String(value);
}
