import { prisma } from './db.js';
import { getSettings, setSetting } from './settings.js';
import { cardHasBingo, generateCard, hasLine, shuffleDeck, winningLineFor } from './bingo.js';
import { broadcast, broadcastState, emitToUser } from './realtime.js';
import { AppError } from './util.js';
import { onStake } from './agents.js';
import { computePayout, totalRealStakes } from './payouts.js';

// Cards are numbered 1..432. Every number is a distinct card and a number
// can only be bought once per round.
export const MAX_CARDS = 432;

const BOT_NAMES = [
  'Abebe', 'Hana', 'Dawit', 'Selam', 'Yonas', 'Mimi', 'Kebede', 'Tigist', 'Bereket',
  'Sara', 'Mulu', 'Fikru', 'Liya', 'Samuel', 'Rahel', 'Tesfaye', 'Eden', 'Nati',
  'Bethel', 'Kalkidan', 'Henok', 'Mahi', 'Getachew', 'Tizita', 'Eyob', 'Ruth',
  'Nahom', 'Meseret', 'Solomon', 'Beza',
];

const state = {
  current: null,
  timer: null,
  ticking: false,
  creating: false,
  joining: new Set(),
};

function pickBotName(used) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Player${Math.floor(Math.random() * 9000) + 1000}`;
  used.add(fallback);
  return fallback;
}

function randomPhone4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function phone4From(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : randomPhone4();
}

function randomPhone() {
  return `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

/** Public winner phone format: +251*****9780 (only the last four digits are visible). */
export function maskPhone(value) {
  return `+251*****${phone4From(value)}`;
}

function winnerCardFor(player, called) {
  const cards = player.cards || [];
  const slots = player.slots || [];
  for (let index = 0; index < cards.length; index += 1) {
    const line = winningLineFor(cards[index], called);
    if (line) return { card: cards[index], line, cardNumber: slots[index] || index + 1 };
  }
  return cards.length
    ? { card: cards[0], line: null, cardNumber: slots[0] || 1 }
    : null;
}

function cardForSlot(round, slot) {
  return generateCard((round.seed + slot * 7919) >>> 0);
}

function prizePoolFor(round) {
  return computePayout({
    stakes: totalRealStakes(round.players),
    platformFeeRate: getSettings().platformFeeRate,
    realWinnerCount: 0,
  }).pool;
}

function playerHasBingo(player, round) {
  return cardHasBingo(player.cards, round.called);
}

export function getPublicState() {
  const round = state.current;
  if (!round) {
    return { status: 'IDLE', playersCount: 0, realCount: 0, calledNumbers: [], prizePool: 0, stake: 0 };
  }
  const now = Date.now();
  return {
    id: round.id,
    status: round.status,
    stake: round.stake,
    prizePool: round.prizePool,
    playersCount: round.players.length,
    calledNumbers: [...round.called],
    lastCalled: round.lastCalled,
    takenCards: [...round.taken.keys()],
    nextCallInMs: round.status === 'CALLING' ? Math.max(0, round.nextCallAt - now) : null,
    startsInMs: round.status === 'WAITING' && Number(getSettings().autoStart) !== 0
      ? Math.max(0, round.waitEndsAt - now)
      : null,
    selectionEndsInMs: round.status === 'WAITING' ? Math.max(0, round.waitEndsAt - now) : null,
    nextRoundInMs: round.status === 'ENDED' ? Math.max(0, round.nextRoundAt - now) : null,
    winners: round.winners || [],
    drawNumber: round.called.size,
  };
}

export function getPlayerView(round, userId) {
  if (!round) return null;
  const player = round.players.find((p) => p.userId === userId);
  if (!player) return null;
  const payout = (round.payouts || {})[player.id] || 0;
  return {
    playerId: player.id,
    cards: player.cards,
    slots: player.slots || [],
    spent: player.paidStake || 0,
    blocked: round.blocked.has(userId),
    hasBingo: playerHasBingo(player, round),
    isWinner: Boolean(round.winnerIds?.includes(player.id)),
    winAmount: payout,
    roundId: round.id,
  };
}

export function getStateForUser(userId) {
  return { ...getPublicState(), you: getPlayerView(state.current, userId) };
}

function broadcastAll() {
  const pub = getPublicState();
  broadcastState(pub);
  const round = state.current;
  if (!round) return;
  for (const player of round.players) {
    if (player.userId) {
      emitToUser(player.userId, 'you', getPlayerView(round, player.userId));
    }
  }
}

async function refundStaleRounds() {
  const stale = await prisma.game.findMany({
    where: { status: { in: ['WAITING', 'CALLING'] } },
    include: { players: true },
  });
  for (const game of stale) {
    for (const p of game.players) {
      if (!p.isBot && p.userId && p.paidStake > 0) {
        await prisma.$transaction([
          prisma.user.update({ where: { id: p.userId }, data: { balance: { increment: p.paidStake } } }),
          prisma.transaction.create({
            data: {
              userId: p.userId,
              type: 'refund',
              amount: p.paidStake,
              status: 'completed',
              reference: `game:${game.id}`,
              meta: 'Round interrupted by server restart',
            },
          }),
        ]);
        emitToUser(p.userId, 'balance', { refreshed: true });
      }
    }
    await prisma.game.update({
      where: { id: game.id },
      data: { status: 'ENDED', endedAt: new Date(), platformFee: 0, prizePool: 0 },
    });
  }
}

async function resolveNextWinner() {
  const raw = getSettings().nextWinner;
  if (!raw || raw === 'none') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.type === 'user' && parsed.userId) {
    const user = await prisma.user.findUnique({ where: { id: Number(parsed.userId) } });
    if (user && !user.isBanned) {
      return { type: 'user', userId: user.id, name: user.firstName || user.username || `User ${user.id}` };
    }
  }
  if (parsed.type === 'bot') {
    return { type: 'bot', name: parsed.name || 'Lucky Bot' };
  }
  return null;
}

async function createRound() {
  if (state.creating || state.current) return;
  state.creating = true;
  try {
    const settings = getSettings();
    const stake = Math.max(100, Number(settings.stake));
    const botCount = Math.max(0, Math.min(50, Number(settings.botCount)));
    const forced = await resolveNextWinner();

    const game = await prisma.game.create({
      data: {
        stake,
        botCount,
        status: 'WAITING',
        forcedWinnerType: forced?.type || null,
        forcedWinnerId: forced?.type === 'user' ? forced.userId : null,
      },
    });

    const round = {
      id: game.id,
      status: 'WAITING',
      stake,
      seed: game.id * 2654435761,
      bots: [],
      players: [],
      called: new Set(),
      lastCalled: null,
      deck: shuffleDeck(),
      taken: new Map(),
      waitEndsAt: Date.now() + Math.max(5, Number(settings.waitSeconds)) * 1000,
      nextCallAt: 0,
      nextRoundAt: 0,
      blocked: new Set(),
      prizePool: 0,
      winners: [],
      winnerIds: [],
      payouts: {},
      forcedWinner: forced,
    };

    const used = new Set();
    const freeSlots = Array.from({ length: MAX_CARDS }, (_, i) => i + 1);
    for (let i = 0; i < botCount; i += 1) {
      const isForcedBot = forced?.type === 'bot' && i === 0;
      const name = isForcedBot ? forced.name : pickBotName(used);
      // Bots occupy random card numbers too, so a number stays unique per round.
      const slot = freeSlots.splice(Math.floor(Math.random() * freeSlots.length), 1)[0] || i + 1;
      const cards = [cardForSlot(round, slot)];
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          isBot: true,
          botName: name,
          cards: JSON.stringify(cards),
          paidStake: 0,
        },
      });
      round.taken.set(slot, row.id);
      round.players.push({
        id: row.id,
        userId: null,
        isBot: true,
        name,
        phone: randomPhone(),
        phone4: randomPhone4(),
        cards,
        slots: [slot],
        paidStake: 0,
        claimAt: 0,
        claimed: false,
        forced: isForcedBot,
      });
    }

    state.current = round;
    await prisma.game.update({ where: { id: game.id }, data: { status: 'WAITING' } });
    if (forced) await setSetting('nextWinner', 'none');
    await prisma.adminAction.create({
      data: {
        actionType: 'round_create',
        details: `game:${game.id} stake:${stake} bots:${botCount}${forced ? ` forced:${forced.type}:${forced.userId || forced.name}` : ''}`,
      },
    });
    broadcastAll();
    return round;
  } finally {
    state.creating = false;
  }
}

async function startCalling() {
  const round = state.current;
  if (!round || round.status !== 'WAITING') return;
  round.status = 'CALLING';
  round.nextCallAt = Date.now();
  await prisma.game.update({ where: { id: round.id }, data: { status: 'CALLING', startedAt: new Date() } });
  broadcast('game:started', { roundId: round.id });
  broadcastAll();
}

async function callNextNumber() {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  const number = round.deck.pop();
  if (!number) {
    await finishRound(null, 'exhausted');
    return;
  }
  round.called.add(number);
  round.lastCalled = number;
  round.nextCallAt = Date.now() + Math.max(1000, Number(getSettings().callIntervalMs));
  await prisma.calledNumber.create({ data: { gameId: round.id, number } }).catch(() => {});
  broadcast('number', { number, roundId: round.id });
}

function scheduleBotClaims() {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  if (round.forcedWinner?.type === 'user') {
    const inRound = round.players.some((p) => p.userId === round.forcedWinner.userId);
    if (inRound) return; // hold bots for the forced human winner
    // The forced player never joined: let the round play out normally.
    round.forcedWinner = null;
  }
  const now = Date.now();
  for (const player of round.players) {
    if (!player.isBot || player.claimed) continue;
    if (!playerHasBingo(player, round)) continue;
    const quick = round.forcedWinner?.type === 'bot' && player.forced;
    if (!player.claimAt) {
      player.claimAt = now + (quick ? 700 : 1500 + Math.random() * 2500);
    } else if (now >= player.claimAt) {
      player.claimed = true;
      finishRound(player, 'bot');
      return;
    }
  }
}

async function finishRound(triggerPlayer, reason) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  round.status = 'ENDED';
  const settings = getSettings();

  let winners = [];
  if (round.forcedWinner) {
    const forced = round.players.find((p) =>
      round.forcedWinner.type === 'user' ? p.userId === round.forcedWinner.userId : p.isBot && p.forced,
    );
    if (forced) winners = [forced];
  }
  if (!winners.length) {
    winners = round.players.filter((p) => playerHasBingo(p, round));
    if (!winners.length && triggerPlayer) winners = [triggerPlayer];
  }

  const realWinners = winners.filter((p) => !p.isBot);
  const { pool, platformFee, share } = computePayout({
    stakes: totalRealStakes(round.players),
    platformFeeRate: settings.platformFeeRate,
    realWinnerCount: realWinners.length,
  });

  // Everyone is shown the same way: name, last four digits and the winning
  // card. Bot wins are intentionally indistinguishable from player wins.
  round.winners = winners.map((p) => {
    const winning = winnerCardFor(p, round.called);
    return {
      name: p.name,
      phone4: phone4From(p.phone),
      phoneMasked: maskPhone(p.phone),
      amount: p.isBot ? pool : share,
      cardNumber: winning?.cardNumber || 1,
      card: winning?.card || null,
      line: winning?.line || null,
    };
  });
  round.winnerIds = winners.map((p) => p.id);
  round.payouts = {};
  for (const p of winners) if (!p.isBot) round.payouts[p.id] = share;
  round.prizePool = pool;
  round.nextRoundAt = Date.now() + Math.max(2000, Number(settings.roundEndDelayMs));

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: round.id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        prizePool: pool,
        platformFee,
        winnerId: realWinners[0]?.userId || null,
      },
    });

    for (const player of round.players) {
      const isWinner = realWinners.includes(player);
      await tx.gamePlayer.update({
        where: { id: player.id },
        data: {
          hasBingo: playerHasBingo(player, round),
          isWinner,
          winAmount: isWinner ? share : 0,
        },
      });
      if (isWinner && player.userId && share > 0) {
        await tx.user.update({ where: { id: player.userId }, data: { balance: { increment: share } } });
        await tx.transaction.create({
          data: {
            userId: player.userId,
            type: 'win',
            amount: share,
            status: 'completed',
            reference: `game:${round.id}`,
          },
        });
      }
    }

    if (round.forcedWinner) {
      await tx.adminAction.create({
        data: {
          actionType: 'winner_override_used',
          details: `game:${round.id} forced:${round.forcedWinner.type}:${round.forcedWinner.userId || round.forcedWinner.name}`,
        },
      });
    }
  });

  for (const p of realWinners) {
    if (!p.userId) continue;
    const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { balance: true } });
    emitToUser(p.userId, 'balance', { balance: user?.balance ?? 0 });
  }

  broadcast('game:ended', {
    roundId: round.id,
    winners: round.winners,
    winnerIds: round.winnerIds,
    prizePool: pool,
    reason,
  });
  broadcastAll();
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const round = state.current;
    if (!round) {
      await createRound();
      return;
    }
    const now = Date.now();
    if (round.status === 'WAITING') {
      const auto = Number(getSettings().autoStart) !== 0;
      if (auto && now >= round.waitEndsAt) {
        await startCalling();
        await callNextNumber();
      }
    } else if (round.status === 'CALLING') {
      if (now >= round.nextCallAt) {
        await callNextNumber();
      }
      scheduleBotClaims();
    } else if (round.status === 'ENDED' && now >= round.nextRoundAt) {
      state.current = null;
      await createRound();
      return;
    }
    broadcastAll();
  } catch (err) {
    console.error('[engine] tick failed', err);
  } finally {
    state.ticking = false;
  }
}

export async function startEngine() {
  await refundStaleRounds();
  await createRound();
  state.timer = setInterval(tick, 1000);
  console.log('[engine] started');
}

export function stopEngine() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/**
 * Player picks one or more card numbers (1..432) while the round is open.
 * Each pick costs the round stake (20 ETB by default) and is charged
 * immediately. A card number is reserved for the whole round, so no one else
 * can pick it. The waiting window is the selection window (30s by default).
 */
export async function joinRound(user, selection = []) {
  const round = state.current;
  if (!round) throw new AppError('ቀጣዩ ዙር እየተዘጋጀ ነው። ከጥቂት ጊዜ በኋላ እንደገና ይሞክሩ።');
  if (round.status !== 'WAITING') throw new AppError('ይህ ዙር አስቀድሞ ተጀምሯል። ቀጣዩን ዙር ይጠብቁ።');
  if (user.isBanned) throw new AppError('ይህ መለያ ታግዷል።', 403);
  if (Date.now() >= round.waitEndsAt) {
    throw new AppError('የመምረጫ ጊዜው አልቋል። ቀጣዩን ዙር ይጠብቁ።');
  }
  if (state.joining.has(user.id)) {
    throw new AppError('ቀድሞ በመካሄድ ላይ ነው። እባክዎ ትንሽ ይጠብቁ።');
  }

  const raw = Array.isArray(selection) ? selection : selection == null ? [] : [selection];
  const slots = [...new Set(raw.map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v)))];
  if (!slots.length) throw new AppError(`ከ1 እስከ ${MAX_CARDS} የካርድ ቁጥር ይምረጡ።`);
  if (slots.length !== raw.length) throw new AppError('እያንዳንዱን ካርድ አንድ ጊዜ ብቻ ይምረጡ።');
  if (slots.some((s) => s < 1 || s > MAX_CARDS)) {
    throw new AppError(`ካርድ ቁጥር ከ1 እስከ ${MAX_CARDS} መሆን አለበት።`);
  }
  const clash = slots.find((s) => round.taken.has(s));
  if (clash) throw new AppError(`ካርድ #${clash} አስቀድሞ ተመርጧል። ሌላ ቁጥር ይምረጡ።`);

  // Reserve the numbers synchronously so two players can never get the same one.
  state.joining.add(user.id);
  for (const slot of slots) round.taken.set(slot, user.id);

  const total = round.stake * slots.length;
  let charged = false;
  try {
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh || fresh.balance < total) {
      throw new AppError('ቀሪ ሂሳብ በቂ አይደለም። እባክዎ መጀመሪያ ያስገቡ።');
    }

    const reserved = await prisma.user.updateMany({
      where: { id: user.id, balance: { gte: total } },
      data: { balance: { decrement: total } },
    });
    if (reserved.count === 0) throw new AppError('ቀሪ ሂሳብ በቂ አይደለም። እባክዎ መጀመሪያ ያስገቡ።');
    charged = true;

    // The window may have closed while the balance was being checked.
    if (round.status !== 'WAITING' || Date.now() >= round.waitEndsAt) {
      throw new AppError('የመምረጫ ጊዜው አልቋል። ቀጣዩን ዙር ይጠብቁ።');
    }

    const generated = slots.map((slot) => cardForSlot(round, slot));
    let player = round.players.find((p) => p.userId === user.id);

    if (player) {
      player.cards = [...player.cards, ...generated];
      player.slots = [...(player.slots || []), ...slots];
      player.paidStake += total;
      await prisma.gamePlayer.update({
        where: { id: player.id },
        data: { cards: JSON.stringify(player.cards), paidStake: player.paidStake },
      });
    } else {
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: round.id,
          userId: user.id,
          cards: JSON.stringify(generated),
          paidStake: total,
        },
      });
      player = {
        id: row.id,
        userId: user.id,
        isBot: false,
        name: fresh.firstName || fresh.username || `Player ${user.id}`,
        phone: fresh.phone || null,
        phone4: phone4From(fresh.phone),
        cards: generated,
        slots: [...slots],
        paidStake: total,
        claimAt: 0,
        claimed: false,
        forced: false,
      };
      round.players.push(player);
    }

    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'stake',
        amount: total,
        status: 'completed',
        reference: `game:${round.id}`,
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { derash: { increment: Math.floor(total / 1000) } },
    });

    round.prizePool = prizePoolFor(round);
    await prisma.game.update({ where: { id: round.id }, data: { prizePool: round.prizePool } });

    await onStake(user.id, total);

    const updated = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
    emitToUser(user.id, 'balance', { balance: updated.balance });
    emitToUser(user.id, 'you', getPlayerView(round, user.id));
    broadcastAll();

    return {
      playerId: player.id,
      cards: player.cards,
      slots: player.slots,
      spent: player.paidStake,
      balance: updated.balance,
      you: getPlayerView(round, user.id),
    };
  } catch (err) {
    for (const slot of slots) {
      if (round.taken.get(slot) === user.id) round.taken.delete(slot);
    }
    if (charged) {
      await prisma.user
        .update({ where: { id: user.id }, data: { balance: { increment: total } } })
        .catch(() => {});
    }
    throw err;
  } finally {
    state.joining.delete(user.id);
  }
}

export async function claimBingo(user) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') {
    throw new AppError('ማመልከቻ የሚቻልበት ንቁ ዙር የለም።');
  }
  if (round.blocked.has(user.id)) {
    throw new AppError('ከተሳሳተ ጥያቄ በኋላ በዚህ ዙር እንዳያመለክቱ ተከልክለዋል።');
  }
  const player = round.players.find((p) => p.userId === user.id);
  if (!player) throw new AppError('በዚህ ዙር አይጫወቱም።');

  if (!playerHasBingo(player, round)) {
    round.blocked.add(user.id);
    emitToUser(user.id, 'you', getPlayerView(round, user.id));
    throw new AppError('የተሳሳተ ጥያቄ — እስካሁን ቢንጎ የለዎትም። በዚህ ዙር ተከልክለዋል።');
  }

  await finishRound(player, 'claim');
  return { ok: true, winners: round.winners };
}

export async function startRoundNow() {
  const round = state.current;
  if (!round) throw new AppError('No round is waiting.');
  if (round.status !== 'WAITING') throw new AppError('This round is already running.');
  await startCalling();
  await callNextNumber();
  broadcastAll();
}

export async function adminRoundDetails() {
  const round = state.current;
  if (!round) return null;
  return {
    ...getPublicState(),
    realCount: round.players.filter((p) => !p.isBot).length,
    bots: round.players.filter((p) => p.isBot).map((p) => ({ id: p.id, name: p.name })),
    forcedWinner: round.forcedWinner,
    calledOrder: [...round.called],
    realPlayers: round.players
      .filter((p) => !p.isBot)
      .map((p) => ({
        id: p.userId,
        name: p.name,
        bingo: playerHasBingo(p, round),
        cards: p.cards.length,
        numbers: p.slots || [],
      })),
  };
}
