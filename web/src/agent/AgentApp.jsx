import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dt, etb, etbShort } from '../format.js';
import StaffLogin from '../components/StaffLogin.jsx';
import { useToast } from '../components/Toast.jsx';

const TOKEN_KEY = 'bingo_agent_token';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📈' },
  { id: 'referrals', label: 'My Referrals', icon: '👥' },
  { id: 'earnings', label: 'Earnings', icon: '💰' },
  { id: 'withdraw', label: 'Withdraw', icon: '📤' },
  { id: 'marketing', label: 'Marketing', icon: '📣' },
];

const EARN_LABEL = {
  deposit_bonus: 'Deposit bonus',
  activity_bonus: '3-active-users bonus',
  gameplay_commission: 'Gameplay commission',
  withdrawal: 'Withdrawal',
  adjustment: 'Adjustment',
};

export default function AgentApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [form, setForm] = useState({ amount: '', bank: '', accountNumber: '', accountName: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!token) return;
    api('/api/auth/staff/me', { token })
      .then((result) => {
        if (result.account.role !== 'agent') {
          toast('This login is not an agent account.', 'error');
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        } else {
          setAccount(result.account);
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadAll() {
    try {
      const [me, refs, ern, wds] = await Promise.all([
        api('/api/agent/me', { token }),
        api('/api/agent/referrals', { token }),
        api('/api/agent/earnings', { token }),
        api('/api/agent/withdrawals', { token }),
      ]);
      setData(me);
      setReferrals(refs);
      setEarnings(ern);
      setWithdrawals(wds);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    if (account) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  function login(nextToken, nextAccount) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setAccount(nextAccount);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAccount(null);
    setData(null);
  }

  if (!token) {
    return (
      <StaffLogin
        title="Agent Dashboard"
        subtitle="Track referrals and commissions for Africa Bingo."
        expectedRole="agent"
        onLogin={login}
        alternate={
          <Link to="/admin" className="muted small">
            Admin? Open the admin panel →
          </Link>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="center-screen">
        <div className="loader">Loading agent dashboard…</div>
      </div>
    );
  }

  const agent = data.agent;
  const config = data.config;
  const stats = data.stats;
  const pending = withdrawals.find((w) => w.status === 'PENDING');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(agent.referralLink);
      toast('Referral link copied.');
    } catch {
      toast(agent.referralLink, 'info');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    } catch {
      toast(text, 'info');
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/agent/withdrawals', {
        token,
        method: 'POST',
        body: {
          amount: Number(form.amount),
          bank: form.bank,
          accountNumber: form.accountNumber,
          accountName: form.accountName,
        },
      });
      toast('Withdrawal request submitted for approval.');
      setForm({ amount: '', bank: '', accountNumber: '', accountName: '' });
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const marketingMessages = [
    `🎱 Africa Bingo — play live bingo and win real ETB!\nJoin with my link: ${agent.referralLink}`,
    `🎉 20 ETB stake, real cash prizes every round. Register with my invite link and start playing: ${agent.referralLink}`,
    `🇪🇹 ኢትዮ ቢንጎ! በቴሌግራም ላይ ቢንጎ ተጫውተው ገንዘብ ያሸንፉ። በዚህ ሊንክ ይቀላቀሉ፡ ${agent.referralLink}`,
  ];

  return (
    <div className="dashboard-shell agent-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">B</div>
          <div>
            <strong>Africa Bingo</strong>
            <span>Agent Dashboard</span>
          </div>
        </div>
        <nav>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link to="/">Player app</Link>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-head">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="muted small">
              {agent.name} · Code <code>{agent.referralCode}</code>
            </p>
          </div>
          <div className="head-actions">
            <button type="button" className="btn ghost small" onClick={copyLink}>
              Copy referral link
            </button>
            <button type="button" className="btn ghost small" onClick={loadAll}>
              Refresh
            </button>
          </div>
        </header>

        <div className="dashboard-body">
          {tab === 'overview' && (
            <>
              <div className="stat-grid">
                <div className="stat-card gold">
                  <span>Total referrals</span>
                  <strong>{stats.referralCount}</strong>
                  <small>People who joined with your link</small>
                </div>
                <div className="stat-card">
                  <span>Active referrals</span>
                  <strong>{agent.activeReferralCount}</strong>
                  <small>Played at least one game</small>
                </div>
                <div className="stat-card green">
                  <span>Total earned</span>
                  <strong>{etb(agent.totalEarned)} ETB</strong>
                  <small>All-time commissions</small>
                </div>
                <div className="stat-card">
                  <span>Available commission</span>
                  <strong>{etb(agent.commissionBalance)} ETB</strong>
                  <small>Minimum payout {etbShort(config.minWithdraw)} ETB</small>
                </div>
                <div className="stat-card">
                  <span>Pending withdrawal</span>
                  <strong>{etb(stats.pendingWithdrawals)} ETB</strong>
                  <small>{pending ? 'Awaiting admin approval' : 'No request pending'}</small>
                </div>
                <div className="stat-card">
                  <span>Activity bonus</span>
                  <strong>{agent.activityBonusPaid ? 'Paid' : 'Not yet'}</strong>
                  <small>
                    {agent.activeReferralCount}/{config.activityThreshold} active users needed
                  </small>
                </div>
              </div>

              <section className="panel referral-panel">
                <div className="section-title">
                  <h3>Your referral link</h3>
                  <span className="badge gold">{agent.referralCode}</span>
                </div>
                <div className="link-box">
                  <code>{agent.referralLink}</code>
                  <button type="button" className="btn primary small" onClick={copyLink}>
                    Copy
                  </button>
                </div>
                <p className="fine-print">
                  Attribution is permanent: a player who joins with your link stays linked to you for all deposits and
                  gameplay commissions.
                </p>
              </section>

              <section className="panel">
                <div className="section-title">
                  <h3>How you earn</h3>
                </div>
                <div className="rules-grid">
                  <div>
                    <span className="rule-amount">{etb(config.per20Bonus)} ETB</span>
                    <p>For every 20 ETB deposited by a referred player (rounded down).</p>
                  </div>
                  <div>
                    <span className="rule-amount">{etb(config.activityBonus)} ETB</span>
                    <p>One-time bonus when {config.activityThreshold} of your referrals have played a game.</p>
                  </div>
                  <div>
                    <span className="rule-amount">{config.gameplayRate * 100}%</span>
                    <p>Of the platform fee from every stake placed by your referred players.</p>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="section-title">
                  <h3>Latest activity</h3>
                  <button type="button" className="link-btn" onClick={() => setTab('earnings')}>
                    View all
                  </button>
                </div>
                <div className="tx-list compact">
                  {earnings.slice(0, 6).map((tx) => (
                    <div className="tx-row" key={tx.id}>
                      <span className="tx-main">
                        <strong>{EARN_LABEL[tx.type] || tx.type}</strong>
                        <span className="muted small">
                          {dt(tx.createdAt)} {tx.sourceUser ? `· ${tx.sourceUser}` : ''}
                        </span>
                      </span>
                      <span className={`tx-amount ${tx.amount >= 0 ? 'positive' : 'negative'}`}>
                        {tx.amount >= 0 ? '+' : '−'}
                        {etb(Math.abs(tx.amount))} ETB
                      </span>
                    </div>
                  ))}
                  {earnings.length === 0 && <p className="muted small">No commissions yet. Share your link to get started.</p>}
                </div>
              </section>
            </>
          )}

          {tab === 'referrals' && (
            <section className="panel">
              <div className="section-title">
                <h3>Referred players</h3>
                <span className="muted small">Names are masked for privacy</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Joined</th>
                      <th>Deposits</th>
                      <th>Games</th>
                      <th>Commission earned</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((ref) => (
                      <tr key={ref.userId}>
                        <td>{ref.name}</td>
                        <td className="muted small">{dt(ref.joinedAt)}</td>
                        <td>{etb(ref.totalDeposits)} ETB</td>
                        <td>{ref.gamesPlayed}</td>
                        <td>{etb(ref.commissionEarned)} ETB</td>
                        <td>
                          <span className={`status-dot ${ref.active ? 'completed' : 'pending'}`}>
                            {ref.active ? 'ACTIVE' : 'NEW'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {referrals.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          No referrals yet — share your link.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'earnings' && (
            <section className="panel">
              <div className="section-title">
                <h3>Commission ledger</h3>
                <span className="muted small">Every credit and withdrawal</span>
              </div>
              <div className="tx-list">
                {earnings.map((tx) => (
                  <div className="tx-row" key={tx.id}>
                    <span className={`tx-icon ${tx.amount >= 0 ? 'win' : 'withdrawal'}`}>{tx.amount >= 0 ? '↓' : '↑'}</span>
                    <div className="tx-main">
                      <strong>{EARN_LABEL[tx.type] || tx.type}</strong>
                      <span className="muted small">
                        {dt(tx.createdAt)}
                        {tx.sourceUser ? ` · ${tx.sourceUser}` : ''}
                        {tx.note ? ` · ${tx.note}` : ''}
                      </span>
                    </div>
                    <div className="tx-amount">
                      <strong className={tx.amount >= 0 ? 'positive' : 'negative'}>
                        {tx.amount >= 0 ? '+' : '−'}
                        {etb(Math.abs(tx.amount))} ETB
                      </strong>
                      <span className={`status-dot ${tx.status}`}>{tx.status}</span>
                    </div>
                  </div>
                ))}
                {earnings.length === 0 && <p className="muted">No earnings yet.</p>}
              </div>
            </section>
          )}

          {tab === 'withdraw' && (
            <>
              <section className="panel">
                <div className="section-title">
                  <h3>Request commission withdrawal</h3>
                  <span className="badge">Min {etbShort(config.minWithdraw)} ETB</span>
                </div>
                <p className="muted small">Available: {etb(agent.commissionBalance)} ETB</p>
                {pending && (
                  <div className="notice">
                    You have a withdrawal of {etb(pending.amount)} ETB pending approval.
                  </div>
                )}
                <form className="withdraw-form" onSubmit={submitWithdrawal}>
                  <label className="field">
                    <span>Amount (ETB)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.amount}
                      onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Bank / wallet</span>
                    <select
                      value={form.bank}
                      onChange={(event) => setForm((prev) => ({ ...prev, bank: event.target.value }))}
                      required
                    >
                      <option value="">Select…</option>
                      {config.banks.map((bank) => (
                        <option key={bank} value={bank}>
                          {bank}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Account number</span>
                    <input
                      value={form.accountNumber}
                      onChange={(event) => setForm((prev) => ({ ...prev, accountNumber: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Account holder name</span>
                    <input
                      value={form.accountName}
                      onChange={(event) => setForm((prev) => ({ ...prev, accountName: event.target.value }))}
                      required
                    />
                  </label>
                  <button type="submit" className="btn primary big" disabled={busy || Boolean(pending)}>
                    {busy ? 'Submitting…' : 'Submit commission withdrawal'}
                  </button>
                </form>
              </section>

              <section className="panel">
                <div className="section-title">
                  <h3>Withdrawal history</h3>
                </div>
                <div className="tx-list">
                  {withdrawals.map((w) => (
                    <div className="tx-row" key={w.id}>
                      <span className="tx-icon withdrawal">↑</span>
                      <div className="tx-main">
                        <strong>{etb(w.amount)} ETB</strong>
                        <span className="muted small">
                          {w.bank} · {w.accountNumber} · {dt(w.createdAt)}
                        </span>
                        {w.adminNotes && <span className="muted small">Note: {w.adminNotes}</span>}
                      </div>
                      <span className={`status-dot ${w.status.toLowerCase()}`}>{w.status}</span>
                    </div>
                  ))}
                  {withdrawals.length === 0 && <p className="muted small">No withdrawal requests yet.</p>}
                </div>
              </section>
            </>
          )}

          {tab === 'marketing' && (
            <section className="panel">
              <div className="section-title">
                <h3>Marketing materials</h3>
                <span className="muted small">Tap copy and share on Telegram, Facebook or TikTok</span>
              </div>
              <div className="marketing-list">
                {marketingMessages.map((message) => (
                  <div className="marketing-card" key={message}>
                    <p>{message}</p>
                    <button type="button" className="btn primary small" onClick={() => copyText(message)}>
                      Copy message
                    </button>
                  </div>
                ))}
              </div>
              <div className="banner-card">
                <div className="banner-art">
                  <span>ETHIO</span>
                  <strong>BINGO</strong>
                  <em>75-ball · real ETB prizes</em>
                </div>
                <div>
                  <h4>Story / banner text</h4>
                  <p className="muted small">
                    Use your referral link in every post. Players who sign up through it are permanently linked to your
                    agent account — you earn on all their deposits and gameplay.
                  </p>
                  <button type="button" className="link-btn" onClick={() => copyText(agent.referralLink)}>
                    Copy link only
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
