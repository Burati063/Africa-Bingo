import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb, txLabel, txSign } from '../format.js';
import { useToast } from '../components/Toast.jsx';

export default function Users({ token, phoneFilter, onPhoneFilterChange }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [adjust, setAdjust] = useState({ amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [requestingPhone, setRequestingPhone] = useState(false);
  const toast = useToast();

  async function load(query = search, filter = phoneFilter) {
    try {
      setRows(
        await api(
          `/api/admin/users?search=${encodeURIComponent(query)}&phoneStatus=${encodeURIComponent(filter)}`,
          { token },
        ),
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function openDetail(id) {
    if (detail?.user?.id === id) {
      setDetail(null);
      return;
    }
    try {
      const data = await api(`/api/admin/users/${id}`, { token });
      setDetail(data);
      setAdjust({ amount: '', reason: '' });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleBan(user) {
    if (!window.confirm(`${user.isBanned ? 'Unban' : 'Ban'} ${user.firstName || user.username}?`)) return;
    try {
      await api(`/api/admin/users/${user.id}/ban`, {
        token,
        method: 'POST',
        body: { banned: !user.isBanned },
      });
      toast(user.isBanned ? 'User unbanned.' : 'User banned.');
      await load();
      if (detail?.user?.id === user.id) {
        setDetail(await api(`/api/admin/users/${user.id}`, { token }));
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function requestPhone(user) {
    setRequestingPhone(true);
    try {
      const result = await api(`/api/admin/users/${user.id}/request-phone`, {
        token,
        method: 'POST',
      });
      toast(
        result.simulated
          ? 'Telegram bot is not configured, so the request was only logged.'
          : 'Phone number requested on Telegram.',
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRequestingPhone(false);
    }
  }

  async function submitAdjust(event) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${detail.user.id}/adjust`, {
        token,
        method: 'POST',
        body: { amount: Number(adjust.amount), reason: adjust.reason },
      });
      toast('Balance adjusted.');
      setAdjust({ amount: '', reason: '' });
      await load();
      setDetail(await api(`/api/admin/users/${detail.user.id}`, { token }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="users-tab">
      <section className="panel">
        <div className="section-title">
          <h3>Players</h3>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              load();
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, username or Telegram ID"
            />
            <select
              value={phoneFilter}
              onChange={(event) => {
                onPhoneFilterChange(event.target.value);
                load(search, event.target.value);
              }}
              aria-label="Filter by phone number"
            >
              <option value="all">All players</option>
              <option value="missing">No phone number</option>
              <option value="registered">Phone registered</option>
            </select>
            <button type="submit" className="btn ghost small">
              Search
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Phone</th>
                <th>Telegram</th>
                <th>Balance</th>
                <th>Derash</th>
                <th>Agent</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.firstName || user.username || `User ${user.id}`}</strong>
                    <div className="muted small">#{user.id} · joined {dt(user.createdAt)}</div>
                  </td>
                  <td className="muted small">{user.phone || '—'}</td>
                  <td className="muted small">
                    {user.username ? `@${user.username}` : '—'}
                    <div>{user.telegramId}</div>
                  </td>
                  <td>
                    <strong>{etb(user.balance)} ETB</strong>
                  </td>
                  <td>{user.derash}</td>
                  <td>
                    {user.agent ? (
                      <span className="badge gold">{user.agent.referralCode}</span>
                    ) : user.referredBy ? (
                      <span className="muted small">via {user.referredBy.name}</span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>
                    {user.isBanned ? (
                      <span className="status-dot rejected">BANNED</span>
                    ) : (
                      <span className="status-dot completed">ACTIVE</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => openDetail(user.id)}>
                        {detail?.user?.id === user.id ? 'Hide' : 'Details'}
                      </button>
                      <button
                        type="button"
                        className={`link-btn ${user.isBanned ? '' : 'danger'}`}
                        onClick={() => toggleBan(user)}
                      >
                        {user.isBanned ? 'Unban' : 'Ban'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No users found.
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
              {detail.user.firstName || detail.user.username} <span className="muted small">#{detail.user.id}</span>
            </h3>
            <button type="button" className="link-btn" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>

          <div className="mini-grid">
            <div>
              <span className="muted small">Balance</span>
              <strong>{etb(detail.user.balance)} ETB</strong>
            </div>
            <div>
              <span className="muted small">Derash</span>
              <strong>{detail.user.derash}</strong>
            </div>
            <div>
              <span className="muted small">Role</span>
              <strong>{detail.user.role}</strong>
            </div>
            <div>
              <span className="muted small">Phone</span>
              <strong>{detail.user.phone || '—'}</strong>
              {!detail.user.phone && (
                <button
                  type="button"
                  className="link-btn"
                  disabled={requestingPhone}
                  onClick={() => requestPhone(detail.user)}
                >
                  Request on Telegram
                </button>
              )}
            </div>
            <div>
              <span className="muted small">Telegram ID</span>
              <strong>{detail.user.telegramId}</strong>
            </div>
            <div>
              <span className="muted small">Referred by</span>
              <strong>{detail.user.referredByAgentId || '—'}</strong>
            </div>
            <div>
              <span className="muted small">Has played</span>
              <strong>{detail.user.hasPlayed ? 'Yes' : 'No'}</strong>
            </div>
          </div>

          <form className="adjust-form" onSubmit={submitAdjust}>
            <label className="field">
              <span>Adjust balance (ETB, negative to deduct)</span>
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
            <button type="submit" className="btn primary" disabled={busy}>
              Apply adjustment
            </button>
          </form>

          <div className="two-col">
            <div>
              <h4>Recent transactions</h4>
              <div className="tx-list compact">
                {detail.user.transactions.map((tx) => (
                  <div className="tx-row" key={tx.id}>
                    <span className="tx-main">
                      <strong>{txLabel[tx.type] || tx.type}</strong>
                      <span className="muted small">{dt(tx.createdAt)}</span>
                    </span>
                    <span className={`tx-amount ${txSign(tx) === '+' ? 'positive' : 'negative'}`}>
                      {txSign(tx)}
                      {etb(Math.abs(tx.amount))}
                    </span>
                  </div>
                ))}
                {detail.user.transactions.length === 0 && <p className="muted small">No transactions.</p>}
              </div>
            </div>
            <div>
              <h4>Referral downline</h4>
              <div className="tx-list compact">
                {detail.referrals.map((ref) => (
                  <div className="tx-row" key={ref.id}>
                    <span className="tx-main">
                      <strong>{ref.user.firstName || ref.user.username}</strong>
                      <span className="muted small">joined {dt(ref.createdAt)}</span>
                    </span>
                    <span className={`status-dot ${ref.user.hasPlayed ? 'completed' : 'pending'}`}>
                      {ref.user.hasPlayed ? 'ACTIVE' : 'NEW'}
                    </span>
                  </div>
                ))}
                {detail.referrals.length === 0 && <p className="muted small">No referred users.</p>}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
