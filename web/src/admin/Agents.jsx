import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb } from '../format.js';
import { useToast } from '../components/Toast.jsx';

export default function Agents({ token }) {
  const [agents, setAgents] = useState([]);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [promote, setPromote] = useState({ userId: '', email: '', password: '' });
  const [adjust, setAdjust] = useState({ amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    try {
      setAgents(await api('/api/admin/agents', { token }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!search.trim()) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      api(`/api/admin/users?search=${encodeURIComponent(search)}`, { token })
        .then((rows) => setUsers(rows.slice(0, 20)))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, token]);

  async function openDetail(id) {
    if (detail?.agent?.id === id) {
      setDetail(null);
      return;
    }
    try {
      const data = await api(`/api/admin/agents/${id}`, { token });
      setDetail(data);
      setAdjust({ amount: '', reason: '' });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggle(agent) {
    try {
      await api(`/api/admin/agents/${agent.id}/toggle`, { token, method: 'POST' });
      toast(agent.isActive ? 'Agent disabled.' : 'Agent enabled.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function submitPromote(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/api/admin/agents/promote', { token, method: 'POST', body: promote });
      toast(`Agent created. Login: ${result.login.email}`);
      setPromote({ userId: '', email: '', password: '' });
      setSearch('');
      setUsers([]);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust(event) {
    event.preventDefault();
    if (!detail) return;
    try {
      await api(`/api/admin/agents/${detail.agent.id}/adjust`, {
        token,
        method: 'POST',
        body: { amount: Number(adjust.amount), reason: adjust.reason },
      });
      toast('Agent commission balance adjusted.');
      setAdjust({ amount: '', reason: '' });
      await load();
      const refreshed = await api(`/api/admin/agents/${detail.agent.id}`, { token });
      setDetail(refreshed);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      toast('Referral link copied.');
    } catch {
      toast(link, 'info');
    }
  }

  return (
    <div className="agents-tab">
      <section className="panel">
        <div className="section-title">
          <h3>Promote a player to agent</h3>
          <span className="badge">Permanent referral attribution</span>
        </div>
        <form className="promote-form" onSubmit={submitPromote}>
          <label className="field">
            <span>Find player</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, username or Telegram ID"
            />
          </label>
          <label className="field">
            <span>Select player</span>
            <select
              value={promote.userId}
              onChange={(event) => setPromote((prev) => ({ ...prev, userId: event.target.value }))}
              required
            >
              <option value="">Choose…</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.firstName || user.username} · {user.telegramId} · {etb(user.balance)} ETB
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Agent login email</span>
            <input
              type="email"
              value={promote.email}
              onChange={(event) => setPromote((prev) => ({ ...prev, email: event.target.value }))}
              required
              placeholder="agent@example.com"
            />
          </label>
          <label className="field">
            <span>Temporary password</span>
            <input
              type="text"
              minLength={8}
              value={promote.password}
              onChange={(event) => setPromote((prev) => ({ ...prev, password: event.target.value }))}
              required
              placeholder="min 8 characters"
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy || !promote.userId}>
            {busy ? 'Creating…' : 'Create agent account'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-title">
          <h3>Agents</h3>
          <button type="button" className="btn ghost small" onClick={load}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Referral code</th>
                <th>Referrals</th>
                <th>Commission</th>
                <th>Earned</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <strong>{agent.name || `Agent ${agent.id}`}</strong>
                    <div className="muted small">
                      {agent.telegramId} · {agent.pendingWithdrawals ? `${etb(agent.pendingWithdrawals)} ETB pending` : 'no pending'}
                    </div>
                  </td>
                  <td>
                    <code>{agent.referralCode}</code>
                    <div>
                      <button type="button" className="link-btn" onClick={() => copyLink(agent.referralLink)}>
                        copy link
                      </button>
                    </div>
                  </td>
                  <td>
                    {agent.referralCount}
                    <div className="muted small">{agent.activeReferralCount} active</div>
                  </td>
                  <td>
                    <strong>{etb(agent.commissionBalance)} ETB</strong>
                  </td>
                  <td>{etb(agent.totalEarned)} ETB</td>
                  <td>
                    <span className={`status-dot ${agent.isActive ? 'completed' : 'rejected'}`}>
                      {agent.isActive ? 'ACTIVE' : 'DISABLED'}
                    </span>
                    <div className="muted small">{agent.activityBonusPaid ? 'bonus paid' : 'bonus pending'}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => openDetail(agent.id)}>
                        {detail?.agent?.id === agent.id ? 'Hide' : 'Details'}
                      </button>
                      <button type="button" className="link-btn danger" onClick={() => toggle(agent)}>
                        {agent.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No agents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && (
        <section className="panel">
          <div className="section-title">
            <h3>
              {detail.agent.user?.firstName || detail.agent.user?.username}{' '}
              <span className="muted small">#{detail.agent.referralCode}</span>
            </h3>
            <button type="button" className="link-btn" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>

          <div className="mini-grid">
            <div>
              <span className="muted small">Commission balance</span>
              <strong>{etb(detail.agent.commissionBalance)} ETB</strong>
            </div>
            <div>
              <span className="muted small">Total earned</span>
              <strong>{etb(detail.agent.totalEarned)} ETB</strong>
            </div>
            <div>
              <span className="muted small">Active referrals</span>
              <strong>{detail.agent.activeReferralCount}</strong>
            </div>
            <div>
              <span className="muted small">Activity bonus</span>
              <strong>{detail.agent.activityBonusPaid ? 'Paid' : 'Not paid'}</strong>
            </div>
            <div>
              <span className="muted small">Created</span>
              <strong>{dt(detail.agent.createdAt)}</strong>
            </div>
            <div>
              <span className="muted small">Referral link</span>
              <button type="button" className="link-btn" onClick={() => copyLink(detail.agent.referralLink || '')}>
                copy
              </button>
            </div>
          </div>

          <form className="adjust-form" onSubmit={submitAdjust}>
            <label className="field">
              <span>Adjust commission balance (ETB, negative to deduct)</span>
              <input
                type="number"
                step="0.01"
                value={adjust.amount}
                onChange={(event) => setAdjust((prev) => ({ ...prev, amount: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Reason (audit log)</span>
              <input
                value={adjust.reason}
                onChange={(event) => setAdjust((prev) => ({ ...prev, reason: event.target.value }))}
                required
              />
            </label>
            <button type="submit" className="btn primary">
              Apply
            </button>
          </form>

          <h4>Referred users</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Joined</th>
                  <th>Deposits</th>
                  <th>Games</th>
                  <th>Commission</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.referrals.map((ref) => (
                  <tr key={ref.userId}>
                    <td>{ref.name}</td>
                    <td className="muted small">{dt(ref.joinedAt)}</td>
                    <td>{etb(ref.totalDeposits)} ETB</td>
                    <td>{ref.gamesPlayed}</td>
                    <td>{etb(ref.commissionEarned)} ETB</td>
                    <td>
                      <span className={`status-dot ${ref.hasPlayed ? 'completed' : 'pending'}`}>
                        {ref.hasPlayed ? 'ACTIVE' : 'NEW'}
                      </span>
                    </td>
                  </tr>
                ))}
                {detail.referrals.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No referred users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="two-col">
            <div>
              <h4>Commission ledger</h4>
              <div className="tx-list compact">
                {detail.agent.transactions.map((tx) => (
                  <div className="tx-row" key={tx.id}>
                    <span className="tx-main">
                      <strong>{tx.type.replace(/_/g, ' ')}</strong>
                      <span className="muted small">
                        {dt(tx.createdAt)} {tx.note ? `· ${tx.note}` : ''}
                      </span>
                    </span>
                    <span className={`tx-amount ${tx.amount >= 0 ? 'positive' : 'negative'}`}>
                      {tx.amount >= 0 ? '+' : '−'}
                      {etb(Math.abs(tx.amount))} ETB
                    </span>
                  </div>
                ))}
                {detail.agent.transactions.length === 0 && <p className="muted small">No commissions yet.</p>}
              </div>
            </div>
            <div>
              <h4>Commission withdrawals</h4>
              <div className="tx-list compact">
                {detail.withdrawals.map((w) => (
                  <div className="tx-row" key={w.id}>
                    <span className="tx-main">
                      <strong>{etb(w.amount)} ETB</strong>
                      <span className="muted small">
                        {w.bank} · {w.accountNumber} · {dt(w.createdAt)}
                      </span>
                    </span>
                    <span className={`status-dot ${w.status.toLowerCase()}`}>{w.status}</span>
                  </div>
                ))}
                {detail.withdrawals.length === 0 && <p className="muted small">No withdrawals yet.</p>}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
