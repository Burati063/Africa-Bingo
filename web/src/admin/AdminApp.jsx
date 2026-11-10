import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StaffLogin from '../components/StaffLogin.jsx';
import Logo from '../components/Logo.jsx';
import Overview from './Overview.jsx';
import GameControl from './GameControl.jsx';
import Users from './Users.jsx';
import Withdrawals from './Withdrawals.jsx';
import Agents from './Agents.jsx';
import Audit from './Audit.jsx';

const TOKEN_KEY = 'bingo_admin_token';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'game', label: 'Game Control', icon: '🎛️' },
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'withdrawals', label: 'Withdrawals', icon: '💸' },
  { id: 'agents', label: 'Agents', icon: '🤝' },
  { id: 'audit', label: 'Audit Log', icon: '🧾' },
];

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState('overview');
  const [phoneFilter, setPhoneFilter] = useState('all');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;
    api('/api/auth/staff/me', { token })
      .then((result) => {
        if (result.account.role !== 'admin') {
          setError('This account is not an admin.');
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        } else {
          setAccount(result.account);
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setChecking(false));
  }, [token]);

  function login(nextToken, nextAccount) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setAccount(nextAccount);
    setChecking(false);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAccount(null);
  }

  if (!token) {
    return (
      <StaffLogin
        title="Admin Panel"
        subtitle="Manage games, payments, users and agents."
        expectedRole="admin"
        onLogin={login}
        alternate={
          <Link to="/agent" className="muted small">
            Agent? Open the agent dashboard →
          </Link>
        }
      />
    );
  }

  if (checking || !account) {
    return (
      <div className="center-screen">
        <div className="loader">Loading admin panel…</div>
      </div>
    );
  }

  async function downloadCsv(type) {
    try {
      const query = type === 'users' ? `&phoneStatus=${encodeURIComponent(phoneFilter)}` : '';
      const res = await fetch(`/api/admin/export?type=${type}${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={38} />
          <div>
            <strong>Africa Bingo</strong>
            <span>Admin Panel</span>
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
          <Link to="/">Open player app</Link>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-head">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="muted small">Signed in as {account.name || account.email}</p>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="head-actions">
            <button type="button" className="btn ghost small" onClick={() => downloadCsv('users')}>
              Export users
            </button>
            <button type="button" className="btn ghost small" onClick={() => downloadCsv('transactions')}>
              Export transactions
            </button>
          </div>
        </header>

        <div className="dashboard-body">
          {tab === 'overview' && <Overview token={token} onNavigate={setTab} />}
          {tab === 'game' && <GameControl token={token} />}
          {tab === 'users' && (
            <Users token={token} phoneFilter={phoneFilter} onPhoneFilterChange={setPhoneFilter} />
          )}
          {tab === 'withdrawals' && <Withdrawals token={token} />}
          {tab === 'agents' && <Agents token={token} />}
          {tab === 'audit' && <Audit token={token} />}
        </div>
      </main>
    </div>
  );
}
