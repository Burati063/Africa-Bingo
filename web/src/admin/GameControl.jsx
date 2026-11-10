import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { etb, seconds } from '../format.js';
import { useToast } from '../components/Toast.jsx';

function toForm(settings) {
  return {
    stake: Number(settings.stake) / 100,
    botCount: Number(settings.botCount),
    waitSeconds: Number(settings.waitSeconds),
    callIntervalMs: Number(settings.callIntervalMs),
    roundEndDelayMs: Number(settings.roundEndDelayMs),
    platformFeeRate: Number(settings.platformFeeRate) * 100,
    autoStart: settings.autoStart !== '0',
    voiceEnabled: settings.voiceEnabled !== '0',
    minWithdraw: Number(settings.minWithdraw) / 100,
    maxAutoVerify: Number(settings.maxAutoVerify) / 100,
    agentPer20Bonus: Number(settings.agentPer20Bonus) / 100,
    agentActivityBonus: Number(settings.agentActivityBonus) / 100,
    agentActivityThreshold: Number(settings.agentActivityThreshold),
    agentGameplayCommissionRate: Number(settings.agentGameplayCommissionRate) * 100,
    agentMinWithdraw: Number(settings.agentMinWithdraw) / 100,
  };
}

function toPayload(form) {
  return {
    ...form,
    platformFeeRate: Number(form.platformFeeRate) / 100,
    agentGameplayCommissionRate: Number(form.agentGameplayCommissionRate) / 100,
  };
}

export default function GameControl({ token }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [game, setGame] = useState(null);
  const [broadcast, setBroadcast] = useState('');
  const [broadcastImage, setBroadcastImage] = useState('');
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [winnerType, setWinnerType] = useState('none');
  const [winnerUserId, setWinnerUserId] = useState('');
  const [botName, setBotName] = useState('Lucky Bot');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [voiceFiles, setVoiceFiles] = useState([]);
  const [voiceTarget, setVoiceTarget] = useState('num_1');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  async function loadSettings() {
    try {
      const data = await api('/api/admin/settings', { token });
      setSettings(data);
      setForm(toForm(data));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadVoice() {
    try {
      setVoiceFiles(await api('/api/admin/voice', { token }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    loadSettings();
    loadVoice();
    const loadGame = () =>
      api('/api/admin/game/state', { token })
        .then(setGame)
        .catch(() => {});
    loadGame();
    const interval = setInterval(loadGame, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!userSearch.trim()) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      api(`/api/admin/users?search=${encodeURIComponent(userSearch)}`, { token })
        .then((rows) => setUsers(rows.slice(0, 20)))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch, token]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function saveSettings(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await api('/api/admin/settings', {
        token,
        method: 'PUT',
        body: toPayload(form),
      });
      setSettings(updated);
      setForm(toForm(updated));
      toast('Settings saved.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyWinner(event) {
    event.preventDefault();
    try {
      const body = { type: winnerType };
      if (winnerType === 'user') {
        if (!winnerUserId) throw new Error('Choose a player first.');
        body.userId = Number(winnerUserId);
      }
      if (winnerType === 'bot') body.name = botName;
      const result = await api('/api/admin/game/next-winner', { token, method: 'POST', body });
      toast(
        result.nextWinner
          ? `Next winner set to ${result.nextWinner.name || result.nextWinner.type}.`
          : 'Winner override cleared.',
      );
      await loadSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function clearWinner() {
    try {
      await api('/api/admin/game/next-winner', { token, method: 'POST', body: { type: 'none' } });
      toast('Winner override cleared.');
      await loadSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/broadcast', {
        token,
        method: 'POST',
        body: { text: broadcast, imageUrl: broadcastImage || undefined },
      });
      setBroadcastResult(result);
      toast(result.simulated ? 'Broadcast simulated (no bot token configured).' : `Sent to ${result.sent} users.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function uploadVoice(event) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast('Choose an audio file first.', 'error');
      return;
    }
    const data = new FormData();
    data.append('file', file);
    if (voiceTarget.startsWith('num_')) data.append('number', voiceTarget.replace('num_', ''));
    else data.append('key', voiceTarget);
    try {
      await api('/api/admin/voice', { token, method: 'POST', formData: data });
      fileRef.current.value = '';
      toast('Voice file uploaded.');
      await loadVoice();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteVoice(id) {
    if (!window.confirm('Delete this voice file?')) return;
    try {
      await api(`/api/admin/voice/${id}`, { token, method: 'DELETE' });
      await loadVoice();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function startNow() {
    try {
      await api('/api/admin/game/start', { token, method: 'POST' });
      toast('Round started.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!form) return <div className="panel">Loading settings…</div>;

  const override = (() => {
    try {
      return settings?.nextWinner && settings.nextWinner !== 'none' ? JSON.parse(settings.nextWinner) : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="game-control">
      <section className="panel">
        <div className="section-title">
          <h3>Live round</h3>
          <div className="head-actions">
            <button type="button" className="btn ghost small" onClick={startNow}>
              Start round now
            </button>
          </div>
        </div>
        {game ? (
          <>
            <div className="mini-grid">
              <div>
                <span className="muted small">Status</span>
                <strong className={`status-dot ${game.status?.toLowerCase()}`}>{game.status}</strong>
              </div>
              <div>
                <span className="muted small">Round</span>
                <strong>#{game.id}</strong>
              </div>
              <div>
                <span className="muted small">Players</span>
                <strong>
                  {game.playersCount} ({game.realCount} real)
                </strong>
              </div>
              <div>
                <span className="muted small">Numbers called</span>
                <strong>{game.calledNumbers?.length || 0} / 75</strong>
              </div>
              <div>
                <span className="muted small">Prize pool</span>
                <strong>{etb(game.prizePool)} ETB</strong>
              </div>
              <div>
                <span className="muted small">Last call</span>
                <strong>{game.lastCalled || '—'}</strong>
              </div>
              <div>
                <span className="muted small">Timer</span>
                <strong>
                  {game.status === 'WAITING'
                    ? `${seconds(game.startsInMs)}s to start`
                    : game.status === 'CALLING'
                      ? `${seconds(game.nextCallInMs)}s to next call`
                      : `${seconds(game.nextRoundInMs)}s to next round`}
                </strong>
              </div>
              <div>
                <span className="muted small">Forced winner</span>
                <strong>
                  {game.forcedWinner
                    ? `${game.forcedWinner.name} (${game.forcedWinner.type})`
                    : 'none — RNG decides'}
                </strong>
              </div>
            </div>
            <div className="real-players">
              {game.realPlayers?.length ? (
                game.realPlayers.map((player) => (
                  <span key={player.id} className={`player-chip ${player.bingo ? 'bingo' : ''}`}>
                    {player.name}
                    {player.bingo ? ' • BINGO' : ''}
                  </span>
                ))
              ) : (
                <span className="muted small">No real players in this round.</span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">No active round.</p>
        )}
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="section-title">
            <h3>Game settings</h3>
            <span className="badge gold">Applies to next round</span>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <div className="field-row">
              <label className="field">
                <span>Stake (ETB)</span>
                <input type="number" min="1" value={form.stake} onChange={set('stake')} />
              </label>
              <label className="field">
                <span>Bots per round (0–50)</span>
                <input type="number" min="0" max="50" value={form.botCount} onChange={set('botCount')} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Waiting time (seconds)</span>
                <input type="number" min="5" value={form.waitSeconds} onChange={set('waitSeconds')} />
              </label>
              <label className="field">
                <span>Call interval (ms)</span>
                <input type="number" min="1000" step="500" value={form.callIntervalMs} onChange={set('callIntervalMs')} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Round end delay (ms)</span>
                <input
                  type="number"
                  min="2000"
                  step="1000"
                  value={form.roundEndDelayMs}
                  onChange={set('roundEndDelayMs')}
                />
              </label>
              <label className="field">
                <span>Platform fee (%)</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={form.platformFeeRate}
                  onChange={set('platformFeeRate')}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Min player withdrawal (ETB)</span>
                <input type="number" min="1" value={form.minWithdraw} onChange={set('minWithdraw')} />
              </label>
              <label className="field">
                <span>Auto-verify up to (ETB)</span>
                <input type="number" min="1" value={form.maxAutoVerify} onChange={set('maxAutoVerify')} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.autoStart} onChange={set('autoStart')} />
              Auto-start rounds continuously
            </label>
            <label className="check">
              <input type="checkbox" checked={form.voiceEnabled} onChange={set('voiceEnabled')} />
              Voice announcements enabled globally
            </label>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save game settings'}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Agent commission settings</h3>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <label className="field">
              <span>Deposit bonus — ETB per 20 ETB deposited</span>
              <input type="number" step="0.01" min="0" value={form.agentPer20Bonus} onChange={set('agentPer20Bonus')} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Activity bonus (ETB, one-time)</span>
                <input type="number" step="0.01" min="0" value={form.agentActivityBonus} onChange={set('agentActivityBonus')} />
              </label>
              <label className="field">
                <span>Active referrals required</span>
                <input type="number" min="1" value={form.agentActivityThreshold} onChange={set('agentActivityThreshold')} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Gameplay commission (% of platform fee)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={form.agentGameplayCommissionRate}
                  onChange={set('agentGameplayCommissionRate')}
                />
              </label>
              <label className="field">
                <span>Min agent withdrawal (ETB)</span>
                <input type="number" min="1" value={form.agentMinWithdraw} onChange={set('agentMinWithdraw')} />
              </label>
            </div>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save commission settings'}
            </button>
            <p className="fine-print">
              Example: a 20 ETB deposit pays {etb(Number(form.agentPer20Bonus) * 100)} ETB once verified. A 20 ETB stake at{' '}
              {form.platformFeeRate}% fee pays{' '}
              {etb(Number(form.stake) * 100 * (Number(form.platformFeeRate) / 100) * (Number(form.agentGameplayCommissionRate) / 100))} ETB
              gameplay commission.
            </p>
          </form>
        </section>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="section-title">
            <h3>Next winner override</h3>
            <span className="badge danger">Audited</span>
          </div>
          <p className="muted small">
            Overrides RNG for the next round only. Bots are held back while a human winner is forced. Every override is written
            to the audit log.
          </p>
          <div className="current-override">
            Current: <strong>{override ? `${override.name} (${override.type})` : 'none'}</strong>
            {override && (
              <button type="button" className="link-btn" onClick={clearWinner}>
                clear
              </button>
            )}
          </div>
          <form className="winner-form" onSubmit={applyWinner}>
            <label className="field">
              <span>Winner type</span>
              <select
                value={winnerType}
                onChange={(event) => {
                  setWinnerType(event.target.value);
                  setWinnerUserId('');
                }}
              >
                <option value="none">No override</option>
                <option value="user">Specific player</option>
                <option value="bot">A bot</option>
              </select>
            </label>
            {winnerType === 'user' && (
              <>
                <label className="field">
                  <span>Find player</span>
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Telegram ID, username or name"
                  />
                </label>
                <label className="field">
                  <span>Player</span>
                  <select value={winnerUserId} onChange={(event) => setWinnerUserId(event.target.value)}>
                    <option value="">Select a player…</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.firstName || user.username} (@{user.username || user.telegramId}) · {etb(user.balance)} ETB
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {winnerType === 'bot' && (
              <label className="field">
                <span>Bot display name</span>
                <input value={botName} onChange={(event) => setBotName(event.target.value)} maxLength={40} />
              </label>
            )}
            <button type="submit" className="btn primary" disabled={winnerType === 'none'}>
              Set next winner
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Broadcast ads</h3>
            <span className="badge">Telegram bot</span>
          </div>
          <form onSubmit={sendBroadcast}>
            <textarea
              rows={4}
              value={broadcast}
              onChange={(event) => setBroadcast(event.target.value)}
              placeholder="Write an announcement or promo for all players…"
            />
            <label className="field">
              <span>Image URL (optional)</span>
              <input
                value={broadcastImage}
                onChange={(event) => setBroadcastImage(event.target.value)}
                placeholder="https://…/banner.jpg"
              />
            </label>
            <button type="submit" className="btn primary" disabled={!broadcast.trim()}>
              Send broadcast
            </button>
            {broadcastResult && (
              <p className="fine-print">
                {broadcastResult.simulated
                  ? `Simulated Broadcast — ${broadcastResult.total} users would receive it. Set TELEGRAM_BOT_TOKEN to send for real.`
                  : `Delivered: ${broadcastResult.sent} · Failed: ${broadcastResult.failed} · Total: ${broadcastResult.total}`}
              </p>
            )}
          </form>
        </section>
      </div>

      <section className="panel">
        <div className="section-title">
          <h3>Voice files</h3>
          <span className="muted small">One-time recorded audio for numbers and announcements</span>
        </div>
        <form className="voice-upload" onSubmit={uploadVoice}>
          <label className="field">
            <span>Target</span>
            <select value={voiceTarget} onChange={(event) => setVoiceTarget(event.target.value)}>
              {Array.from({ length: 75 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={`num_${n}`}>
                  Number {n}
                </option>
              ))}
              <option value="bingo">Announcement: Bingo!</option>
              <option value="game_start">Announcement: Game starting</option>
            </select>
          </label>
          <input ref={fileRef} type="file" accept="audio/*" />
          <button type="submit" className="btn primary">
            Upload voice
          </button>
        </form>
        <div className="voice-list">
          {voiceFiles.length === 0 && (
            <p className="muted small">
              No voice files yet. Upload Amharic recordings for numbers 1–75 (mp3/ogg) and they will play on the player app.
            </p>
          )}
          {voiceFiles.map((file) => (
            <div className="voice-row" key={file.id}>
              <span className="badge gold">{file.label}</span>
              <a href={file.fileUrl} target="_blank" rel="noreferrer" className="muted small">
                {file.key}
              </a>
              <button type="button" className="link-btn danger" onClick={() => deleteVoice(file.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
