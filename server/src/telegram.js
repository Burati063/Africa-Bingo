import { prisma } from './db.js';
import { linkReferral } from './agents.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

let polling = false;
let updateOffset = 0;
const pendingReferrals = new Map();

async function telegramApi(method, payload = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function miniAppUrl(startParam) {
  if (BOT_USERNAME) {
    const suffix = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '';
    return `https://t.me/${BOT_USERNAME}${suffix}`;
  }
  return process.env.PUBLIC_URL || 'http://localhost:5173';
}

function openAppMarkup(startParam) {
  const url = miniAppUrl(startParam);
  if (!/^https:\/\//i.test(url)) return undefined;
  return { inline_keyboard: [[{ text: '🎱 Open Africa Bingo', url }]] };
}

function cleanPhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').slice(0, 20);
}

async function registerStartUser(from, startParam) {
  const telegramId = String(from.id);
  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        firstName: from.first_name || 'Player',
        username: from.username || null,
      },
    });
  }
  if (startParam && !user.referredByAgentId) {
    await linkReferral(user, startParam);
    user = await prisma.user.findUnique({ where: { id: user.id } });
  }
  return user;
}

async function handleStart(message) {
  const chatId = message.chat.id;
  const startParam = String(message.text || '').split(/\s+/)[1]?.trim() || '';
  if (startParam) pendingReferrals.set(chatId, startParam);

  const user = await registerStartUser(message.from, startParam);
  if (user?.phone) {
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: `እንኳን ደህና መጡ ወደ Africa Bingo! 🎱\n\nWelcome back to Africa Bingo!`,
      reply_markup: openAppMarkup(startParam),
    });
    return;
  }

  await telegramApi('sendMessage', {
    chat_id: chatId,
    text:
      'እንኳን ደህና መጡ ወደ Africa Bingo! 🎱\n\n' +
      'ለመመዝገብ የስልክ ቁጥርዎን ያጋሩ። ከታች ያለውን አዝራር ይጫኑ።\n\n' +
      'Welcome to Africa Bingo! Tap the button below to share your phone number and finish registration.',
    reply_markup: {
      keyboard: [[{ text: '📱 Share phone number / ስልክ ቁጥር አጋራ', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function handleContact(message) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const phone = cleanPhone(message.contact?.phone_number);

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: {
      phone: phone || undefined,
      firstName: message.from.first_name || message.contact?.first_name || undefined,
      username: message.from.username || undefined,
    },
    create: {
      telegramId,
      phone: phone || null,
      firstName: message.from.first_name || message.contact?.first_name || 'Player',
      username: message.from.username || null,
    },
  });

  const startParam = pendingReferrals.get(chatId) || '';
  if (startParam) {
    await linkReferral(user, startParam);
    pendingReferrals.delete(chatId);
  }

  await telegramApi('sendMessage', {
    chat_id: chatId,
    text: '✅ ስልክ ቁጥርዎ ተመዝግቧል።',
    reply_markup: { remove_keyboard: true },
  });

  await telegramApi('sendMessage', {
    chat_id: chatId,
    text:
      '✅ ስልክ ቁጥርዎ ተመዝግቧል። ወደ Africa Bingo ለመግባት ከታች ያለውን ይጫኑ።\n\n' +
      '✅ Your phone number is registered. Tap below to open Africa Bingo.',
    reply_markup: openAppMarkup(startParam),
  });
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message || !message.from) return;
  if (message.contact) {
    await handleContact(message);
    return;
  }
  if (String(message.text || '').startsWith('/start')) {
    await handleStart(message);
  }
}

async function pollLoop() {
  while (polling) {
    try {
      const updates = await telegramApi('getUpdates', {
        offset: updateOffset,
        timeout: 30,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        updateOffset = Math.max(updateOffset, update.update_id + 1);
        handleUpdate(update).catch((err) => console.error('[telegram] update failed', err.message));
      }
    } catch (err) {
      console.error('[telegram] polling failed', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Starts long polling so /start can ask for and store the player's phone
 * number. The Mini App's Telegram contact request is delivered to the bot as a
 * normal contact message, so the same handler covers both entry points.
 */
export function startTelegramBot() {
  if (!BOT_TOKEN || polling) return;
  polling = true;
  console.log('[telegram] phone registration bot started');
  pollLoop();
}

export function stopTelegramBot() {
  polling = false;
}

/**
 * Ask a single player to share their phone number again. Uses the same contact
 * button as the welcome flow, so the reply is stored by handleContact.
 */
export async function requestPhoneFromUser(telegramId) {
  if (!/^-?\d+$/.test(String(telegramId || ''))) {
    throw new Error('This player has no Telegram chat to message.');
  }
  if (!BOT_TOKEN) return { sent: false, simulated: true };

  await telegramApi('sendMessage', {
    chat_id: String(telegramId),
    text:
      'የስልክ ቁጥርዎን እንደገና ያጋሩ። ከታች ያለውን አዝራር ይጫኑ።\n\n' +
      'Please share your phone number to finish registration. Tap the button below.',
    reply_markup: {
      keyboard: [[{ text: '📱 Share phone number / ስልክ ቁጥር አጋራ', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
  return { sent: true, simulated: false };
}

/**
 * Broadcast an ad / announcement through the Telegram bot. When no bot token is
 * configured the broadcast is recorded as simulated so it can be tested locally.
 */
export async function broadcastTelegram(text, staffId = null, imageUrl = null) {
  const users = await prisma.user.findMany({
    where: { isBanned: false },
    select: { telegramId: true },
  });

  let sent = 0;
  let failed = 0;
  const photo = imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : null;
  if (BOT_TOKEN) {
    for (const user of users) {
      if (!/^-?\d+$/.test(user.telegramId)) {
        failed += 1;
        continue;
      }
      try {
        const method = photo ? 'sendPhoto' : 'sendMessage';
        const payload = photo
          ? { chat_id: user.telegramId, photo, caption: text }
          : { chat_id: user.telegramId, text, disable_web_page_preview: true };
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  await prisma.adminAction.create({
    data: {
      staffId,
      actionType: 'broadcast',
      details: JSON.stringify({
        simulated: !BOT_TOKEN,
        total: users.length,
        sent,
        failed,
        hasImage: Boolean(photo),
        text: text.slice(0, 300),
      }),
    },
  });

  return { sent, failed, total: users.length, simulated: !BOT_TOKEN };
}
