import { prisma } from './db.js';
import { getSettings, setSetting } from './settings.js';
import { cardHasBingo, generateCard, hasLine, shuffleDeck, winningLineFor } from './bingo.js';
import { broadcast, broadcastState, emitToUser } from './realtime.js';
import { AppError } from './util.js';
import { onStake } from './agents.js';
import { computePayout, totalRealStakes } from './payouts.js';

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

function winnerCardFor(player, called) {
  const cards = player.cards || [];
  for (let index = 0; index < cards.length; index += 1) {
    const line = winningLineFor(cards[index], called);
    if (line) return { card: cards[index], line, cardNumber: index + 1 };
  }
  return cards.length ? { card: cards[0], line: null, cardNumber: 1 } : null;
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
    nextCallInMs: round.status === 'CALLING' ? Math.max(0, round.nextCallAt - now) : null,
    startsInMs: round.status === 'WAITING' && Number(getSettings().autoStart) !== 0
      ? Math.max(0, round.waitEndsAt - now)
      : null,
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
      bots: [],
      players: [],
      called: new Set(),
      lastCalled: null,
      deck: shuffleDeck(),
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
    for (let i = 0; i < botCount; i += 1) {
      const isForcedBot = forced?.type === 'bot' && i === 0;
      const name = isForcedBot ? forced.name : pickBotName(used);
      const cards = [generateCard()];
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          isBot: true,
          botName: name,
          cards: JSON.stringify(cards),
          paidStake: 0,
        },
      });
      round.players.push({
        id: row.id,
        userId: null,
        isBot: true,
        name,
        phone4: randomPhone4(),
        cards,
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
      phone4: p.phone4 || phone4From(p.phone || p.userId),
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
 * Player buys 1-3 cards for the current waiting round. All money movement is
 * server-side and the balance check is atomic.
 */
export async function joinRound(user, cardCount = 1) {
  const round = state.current;
  if (!round) throw new AppError('The next round is being prepared. Try again in a moment.');
  if (round.status !== 'WAITING') throw new AppError('This round already started. Wait for the next one.');
  if (user.isBanned) throw new AppError('This account is suspended.', 403);
  if (round.players.some((p) => p.userId === user.id)) throw new AppError('You already joined this round.');

  const cards = Math.max(1, Math.min(3, Number(cardCount) || 1));
  const total = round.stake * cards;
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fresh || fresh.balance < total) throw new AppError('Insufficient balance. Please deposit first.');

  const reserved = await prisma.user.updateMany({
    where: { id: user.id, balance: { gte: total } },
    data: { balance: { decrement: total } },
  });
  if (reserved.count === 0) throw new AppError('Insufficient balance. Please deposit first.');

  const generated = Array.from({ length: cards }, () => generateCard());
  const row = await prisma.gamePlayer.create({
    data: {
      gameId: round.id,
      userId: user.id,
      cards: JSON.stringify(generated),
      paidStake: total,
    },
  });
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

  round.players.push({
    id: row.id,
    userId: user.id,
    isBot: false,
    name: fresh.firstName || fresh.username || `Player ${user.id}`,
    phone: fresh.phone || fresh.telegramId,
    phone4: phone4From(fresh.phone || fresh.telegramId),
    cards: generated,
    paidStake: total,
    claimAt: 0,
    claimed: false,
    forced: false,
  });
  round.prizePool = prizePoolFor(round);
  await prisma.game.update({ where: { id: round.id }, data: { prizePool: round.prizePool } });

  await onStake(user.id, total);

  const updated = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
  emitToUser(user.id, 'balance', { balance: updated.balance });
  emitToUser(user.id, 'you', getPlayerView(round, user.id));
  broadcastAll();

  return { playerId: row.id, cards: generated, balance: updated.balance };
}

export async function claimBingo(user) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') {
    throw new AppError('There is no active round to claim.');
  }
  if (round.blocked.has(user.id)) {
    throw new AppError('You were blocked from claiming this round after a false claim.');
  }
  const player = round.players.find((p) => p.userId === user.id);
  if (!player) throw new AppError('You are not playing in this round.');

  if (!playerHasBingo(player, round)) {
    round.blocked.add(user.id);
    emitToUser(user.id, 'you', getPlayerView(round, user.id));
    throw new AppError('False claim — you do not have bingo yet. You are blocked for this round.');
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
      .map((p) => ({ id: p.userId, name: p.name, bingo: playerHasBingo(p, round), cards: p.cards.length })),
  };
}
