import { prisma } from './db.js';
import { dayKey, daysAgo } from './util.js';

export async function adminOverview() {
  const since = daysAgo(13);
  const weekAgo = daysAgo(6);
  const monthAgo = daysAgo(29);

  const [transactions, games, agentTx, usersCount, newUsers, pendingWithdrawals, pendingAgentWithdrawals, pendingDeposits, pendingAgents] =
    await Promise.all([
      prisma.transaction.findMany({ where: { createdAt: { gte: since }, status: 'completed' } }),
      prisma.game.findMany({ where: { createdAt: { gte: since } } }),
      prisma.agentTransaction.findMany({ where: { createdAt: { gte: since }, status: 'completed' } }),
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.agentWithdrawal.count({ where: { status: 'PENDING' } }),
      prisma.deposit.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.agent.count({ where: { activityBonusPaid: true } }),
    ]);

  const sum = (rows, type) =>
    rows.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);

  const allGames = await prisma.game.findMany({
    where: { status: 'ENDED' },
    select: { stake: true, platformFee: true, prizePool: true, createdAt: true },
  });
  const winAgg = await prisma.transaction.aggregate({
    where: { type: 'win', status: 'completed' },
    _max: { amount: true },
    _sum: { amount: true },
  });

  const activeDaily = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: daysAgo(0) } },
  });
  const activeWeekly = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: weekAgo } },
  });
  const activeMonthly = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: monthAgo } },
  });

  const agentCommissions = agentTx
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const referralBonuses = agentTx
    .filter((t) => t.type === 'deposit_bonus' || t.type === 'activity_bonus')
    .reduce((acc, t) => acc + t.amount, 0);
  const platformFees = allGames.reduce((acc, g) => acc + g.platformFee, 0);

  const days = [];
  for (let i = 13; i >= 0; i -= 1) days.push(dayKey(daysAgo(i)));

  const series = days.map((day) => {
    const dayTx = transactions.filter((t) => dayKey(t.createdAt) === day);
    const dayGames = games.filter((g) => dayKey(g.createdAt) === day);
    return {
      day,
      deposits: sum(dayTx, 'deposit') / 100,
      withdrawals: sum(dayTx, 'withdrawal') / 100,
      rounds: dayGames.length,
      winPayouts: sum(dayTx, 'win') / 100,
      gmv: sum(dayTx, 'stake') / 100,
    };
  });

  const countsByType = ['deposit', 'withdrawal', 'stake', 'win'].map((type) => ({
    label: type,
    value: transactions.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0) / 100,
  }));

  const avgStake = allGames.length
    ? allGames.reduce((acc, g) => acc + g.stake, 0) / allGames.length / 100
    : 0;
  const avgPrize = allGames.length
    ? allGames.reduce((acc, g) => acc + g.prizePool, 0) / allGames.length / 100
    : 0;

  const roundsWithPlayers = await prisma.game.findMany({
    where: { status: 'ENDED' },
    select: { _count: { select: { players: true } } },
    take: 200,
    orderBy: { id: 'desc' },
  });
  const avgPlayers = roundsWithPlayers.length
    ? roundsWithPlayers.reduce((acc, g) => acc + g._count.players, 0) / roundsWithPlayers.length
    : 0;

  return {
    totals: {
      deposits: sum(transactions, 'deposit'),
      withdrawals: sum(transactions, 'withdrawal'),
      platformFees,
      agentCommissions,
      referralBonuses,
      netRevenue: platformFees - agentCommissions,
      winPayouts: winAgg._sum.amount || 0,
      gmv: sum(transactions, 'stake'),
      players: usersCount,
      newUsersWeek: newUsers,
      agentsWithBonus: pendingAgents,
    },
    active: {
      daily: activeDaily.length,
      weekly: activeWeekly.length,
      monthly: activeMonthly.length,
    },
    gameStats: {
      rounds: allGames.length,
      avgStake,
      avgPrize,
      avgPlayers,
      biggestWin: winAgg._max.amount || 0,
    },
    pending: {
      withdrawals: pendingWithdrawals,
      agentWithdrawals: pendingAgentWithdrawals,
      deposits: pendingDeposits,
    },
    series,
    pie: countsByType,
  };
}

const csvEscape = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');

export async function exportCsv(type) {
  if (type === 'transactions') {
    const rows = await prisma.transaction.findMany({ orderBy: { id: 'desc' }, take: 5000 });
    return toCsv(
      ['id', 'userId', 'type', 'amountETB', 'status', 'reference', 'meta', 'createdAt'],
      rows.map((t) => [t.id, t.userId, t.type, t.amount / 100, t.status, t.reference, t.meta, t.createdAt.toISOString()]),
    );
  }
  if (type === 'withdrawals') {
    const rows = await prisma.withdrawal.findMany({ orderBy: { id: 'desc' }, take: 5000 });
    return toCsv(
      ['id', 'userId', 'amountETB', 'bank', 'accountNumber', 'accountName', 'status', 'adminNotes', 'createdAt'],
      rows.map((w) => [w.id, w.userId, w.amount / 100, w.bank, w.accountNumber, w.accountName, w.status, w.adminNotes, w.createdAt.toISOString()]),
    );
  }
  if (type === 'agents') {
    const rows = await prisma.agent.findMany({ include: { user: true } });
    return toCsv(
      ['agentId', 'name', 'referralCode', 'activeReferrals', 'commissionBalanceETB', 'totalEarnedETB', 'activityBonusPaid', 'isActive'],
      rows.map((a) => [
        a.id,
        a.user.firstName || a.user.username,
        a.referralCode,
        a.activeReferralCount,
        a.commissionBalance / 100,
        a.totalEarned / 100,
        a.activityBonusPaid,
        a.isActive,
      ]),
    );
  }
  const rows = await prisma.user.findMany({ orderBy: { id: 'desc' }, take: 5000 });
  return toCsv(
    ['id', 'telegramId', 'username', 'firstName', 'balanceETB', 'derash', 'role', 'referredByAgentId', 'isBanned', 'hasPlayed', 'createdAt'],
    rows.map((u) => [
      u.id,
      u.telegramId,
      u.username,
      u.firstName,
      u.balance / 100,
      u.derash,
      u.role,
      u.referredByAgentId,
      u.isBanned,
      u.hasPlayed,
      u.createdAt.toISOString(),
    ]),
  );
}
