import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Logo from './Logo.jsx';

export default function StaffLogin({ title, subtitle, expectedRole = 'admin', onLogin, alternate }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api('/api/auth/staff/login', { method: 'POST', body: { email, password } });
      if (expectedRole && result.account.role !== expectedRole) {
        throw new Error(
          expectedRole === 'admin'
            ? 'This login is for agents. Use the agent portal.'
            : 'This login is for admins. Use the admin panel.',
        );
      }
      onLogin(result.token, result.account);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="staff-login">
      <div className="staff-login-card">
        <Logo size={58} />
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="login-links">
          {alternate}
          <Link to="/">← Player app</Link>
        </div>
      </div>
    </div>
  );
}
