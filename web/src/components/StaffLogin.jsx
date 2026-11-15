import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Logo from './Logo.jsx';

export default function StaffLogin({ title, subtitle, expectedRole = 'admin', onLogin, alternate }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
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

  async function resetPassword(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api('/api/auth/staff/forgot-password', {
        method: 'POST',
        body: { email, phone, password },
      });
      setMode('login');
      setPassword('');
      setPhone('');
      setNotice(`New password saved for ${result.email}. Sign in with it now.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
  }

  const resetting = mode === 'forgot';

  return (
    <div className="staff-login">
      <div className="staff-login-card">
        <Logo size={58} />
        <h1>{resetting ? 'Reset agent password' : title}</h1>
        <p className="muted">
          {resetting
            ? 'Enter your agent email and the phone number on your agent account to set a new password.'
            : subtitle}
        </p>
        {resetting ? (
          <form onSubmit={resetPassword}>
            <label className="field">
              <span>Agent email</span>
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
              <span>Registered phone number</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="09xxxxxxxx"
                required
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="min 8 characters"
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="btn primary big" disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
            <button type="button" className="link-btn" onClick={() => switchMode('login')}>
              ← Back to sign in
            </button>
          </form>
        ) : (
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
            {notice && <div className="form-note">{notice}</div>}
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="btn primary big" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {expectedRole === 'agent' && (
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            )}
          </form>
        )}
        <div className="login-links">
          {alternate}
          <Link to="/">← Player app</Link>
        </div>
      </div>
    </div>
  );
}
