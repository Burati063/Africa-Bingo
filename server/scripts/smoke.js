import 'dotenv/config';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bingo.et';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';
const AGENT_EMAIL = process.env.AGENT_EMAIL || 'agent@bingo.et';
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || 'Agent@12345';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function request(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(800);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const health = await request('/api/health');
  check('server health', health.status === 200);

  const adminLogin = await request('/api/auth/staff/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!adminLogin.data.token) throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.data)}`);
  const adminToken = adminLogin.data.token;
  check('admin login', adminLogin.status === 200);

  const settings = await request('/api/admin/settings', {
    token: adminToken,
    method: 'PUT',
    body: {
      stake: 20,
      botCount: 0,
      waitSeconds: 6,
      callIntervalMs: 1000,
      roundEndDelayMs: 3000,
      platformFeeRate: 0.2,
      autoStart: true,
      voiceEnabled: true,
      minWithdraw: 50,
      maxAutoVerify: 5000,
      agentPer20Bonus: 1,
      agentActivityBonus: 3,
      agentActivityThreshold: 3,
      agentGameplayCommissionRate: 0.05,
      agentMinWithdraw: 50,
    },
  });
  check('admin can update settings', settings.status === 200);

  const telegramId = `smoke-${Date.now()}`;
  const register = await request('/api/auth/telegram', {
    method: 'POST',
    body: { devTelegramId: telegramId, devFirstName: 'Smoke', startParam: 'AGDEMO' },
  });
  check('player registration with referral', register.status === 200 && register.data.user);
  const playerToken = register.data.token;
  check('player is linked to agent', Boolean(register.data.user?.referredByAgentId));

  // A CBE PDF receipt cannot be read automatically, so it lands in the admin
  // review queue without any outbound network call. The admin then approves it
  // with the real amount, which credits the wallet and pays agent commission.
  const receiptLink = `https://apps.cbe.com.et/receipt/smoke-${Date.now()}.pdf`;
  const deposit = await request('/api/wallet/deposit/verify-link', {
    token: playerToken,
    method: 'POST',
    body: { link: receiptLink },
  });
  check(
    'unreadable receipt sent to admin review',
    deposit.status === 200 && deposit.data.status === 'pending_review',
    JSON.stringify(deposit.data),
  );

  const duplicate = await request('/api/wallet/deposit/verify-link', {
    token: playerToken,
    method: 'POST',
    body: { link: receiptLink },
  });
  check('duplicate receipt link rejected', duplicate.status === 409);

  const pending = await request('/api/admin/deposits?status=PENDING_REVIEW', { token: adminToken });
  const reviewRow = pending.data.find((d) => d.id === deposit.data.depositId);
  check('deposit appears in review queue', Boolean(reviewRow), JSON.stringify(pending.data?.[0] || {}));

  const approve = await request(`/api/admin/deposits/${deposit.data.depositId}/approve`, {
    token: adminToken,
    method: 'POST',
    body: { amount: 40 },
  });
  check('admin approved the deposit', approve.status === 200, JSON.stringify(approve.data));

  const playerMe = await request('/api/me', { token: playerToken });
  check('wallet credited with 40 ETB', playerMe.data.user?.balance === 4000, `balance=${playerMe.data.user?.balance}`);

  const agentLogin = await request('/api/auth/staff/login', {
    method: 'POST',
    body: { email: AGENT_EMAIL, password: AGENT_PASSWORD },
  });
  const agentToken = agentLogin.data.token;
  check('agent login', agentLogin.status === 200);
  const agentMe = await request('/api/agent/me', { token: agentToken });
  check('agent earned 2 ETB from 40 ETB deposit', agentMe.data.agent?.commissionBalance >= 200, `commission=${agentMe.data.agent?.commissionBalance}`);

  const waiting = await waitFor(
    async () => {
      const state = await request('/api/game/state', { token: playerToken });
      return state.data.status === 'WAITING' &&
        state.data.bots === undefined &&
        state.data.realCount === undefined &&
        (state.data.startsInMs ?? 0) > 3000
        ? state.data
        : null;
    },
    240000,
    'a waiting round without bots',
  );
  check('round accepting players', waiting.status === 'WAITING');

  const join = await request('/api/game/join', { token: playerToken, method: 'POST', body: { cards: 1 } });
  check('player joined round', join.status === 200 && join.data.cards?.length === 1, JSON.stringify(join.data));
  check('stake deducted', join.data.balance === 2000, `balance=${join.data.balance}`);

  let claimed = false;
  let ended = null;
  const deadline = Date.now() + 200000;
  while (Date.now() < deadline) {
    const state = await request('/api/game/state', { token: playerToken });
    if (state.data.status === 'CALLING' && state.data.you?.hasBingo && !claimed) {
      const claim = await request('/api/game/claim', { token: playerToken, method: 'POST' });
      check('bingo claim accepted', claim.status === 200, JSON.stringify(claim.data));
      claimed = true;
    }
    if (state.data.status === 'ENDED') {
      ended = state.data;
      break;
    }
    await sleep(700);
  }
  check('round finished', Boolean(ended));
  let playerWon = false;
  if (ended) {
    playerWon = Boolean(ended.you?.isWinner);
    check(
      'winner shown without bot identity',
      ended.winners?.length > 0 && ended.winners.every((w) => w.phone4 && w.isBot === undefined),
      JSON.stringify(ended.winners),
    );
    check(
      'winner card and last four digits are public',
      Boolean(ended.winners?.[0]?.card?.length === 5 && ended.winners?.[0]?.cardNumber),
      JSON.stringify(ended.winners?.[0] || {}),
    );
  }

  const wallet = await request('/api/wallet/transactions', { token: playerToken });
  const types = new Set(wallet.data.map((t) => t.type));
  check(
    'ledger recorded deposit and stake',
    types.has('deposit') && types.has('stake'),
    [...types].join(','),
  );
  check('win ledger matches the winner', playerWon ? types.has('win') : !types.has('win'), [...types].join(','));

  const agentEarnings = await request('/api/agent/earnings', { token: agentToken });
  const bonuses = agentEarnings.data.filter((e) => e.type === 'deposit_bonus');
  const gameplay = agentEarnings.data.filter((e) => e.type === 'gameplay_commission');
  check('agent deposit bonus recorded', bonuses.length > 0);
  check('agent gameplay commission recorded', gameplay.length > 0);

  const overview = await request('/api/admin/overview', { token: adminToken });
  check('admin overview available', overview.status === 200 && overview.data.totals?.players > 0);

  await request('/api/admin/settings', {
    token: adminToken,
    method: 'PUT',
    body: {
      stake: 20,
      botCount: 8,
      waitSeconds: 20,
      callIntervalMs: 3000,
      roundEndDelayMs: 8000,
      platformFeeRate: 0.2,
      autoStart: true,
      voiceEnabled: true,
      minWithdraw: 50,
      maxAutoVerify: 5000,
      agentPer20Bonus: 1,
      agentActivityBonus: 3,
      agentActivityThreshold: 3,
      agentGameplayCommissionRate: 0.05,
      agentMinWithdraw: 50,
    },
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
