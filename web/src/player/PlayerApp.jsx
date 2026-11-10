import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api } from '../api.js';
import { haptic, tg } from '../telegram.js';
import { useToast } from '../components/Toast.jsx';
import TopBar from './TopBar.jsx';
import GameScreen from './GameScreen.jsx';

const TOKEN_KEY = 'bingo_player_token';

export default function PlayerApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [you, setYou] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authError, setAuthError] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem('bingo_voice') !== 'off');
  const toast = useToast();
  const youRef = useRef(null);
  const gameRef = useRef(null);
  const authStarted = useRef(false);
  const phoneAsked = useRef(false);

  youRef.current = you;
  gameRef.current = game;

  const refreshMe = useCallback(async () => {
    const tk = localStorage.getItem(TOKEN_KEY);
    if (!tk) return;
    try {
      const data = await api('/api/me', { token: tk });
      setMe(data);
    } catch (err) {
      if (err.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setAuthError('Your session expired. Reopen the app from Telegram.');
      }
    }
  }, []);

  useEffect(() => {
    if (authStarted.current) return;
    authStarted.current = true;

    let cancelled = false;

    async function authenticate() {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        try {
          const data = await api('/api/me', { token: stored });
          if (!cancelled) {
            setToken(stored);
            setMe(data);
          }
          return;
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      }

      try {
        const initData = tg?.initData || '';
        const startParam =
          new URLSearchParams(window.location.search).get('start') ||
          tg?.initDataUnsafe?.start_param ||
          undefined;
        let devTelegramId = localStorage.getItem('bingo_dev_id');
        if (!devTelegramId) {
          devTelegramId = `dev-${Math.random().toString(36).slice(2, 10)}`;
          localStorage.setItem('bingo_dev_id', devTelegramId);
        }
        const result = await api('/api/auth/telegram', {
          method: 'POST',
          body: {
            initData,
            startParam,
            devTelegramId: initData ? undefined : devTelegramId,
            devFirstName: initData ? undefined : 'Dev Player',
          },
        });
        localStorage.setItem(TOKEN_KEY, result.token);
        if (!cancelled) {
          setToken(result.token);
          if (result.user?.isBanned) {
            setAuthError('This account is suspended.');
            return;
          }
          setMe(await api('/api/me', { token: result.token }));
        }
      } catch (err) {
        if (!cancelled) setAuthError(err.message || 'Could not sign in.');
      }
    }

    authenticate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ask for the phone number once. Telegram delivers the contact to the bot,
  // which stores it against this player's account.
  useEffect(() => {
    if (!me || me.user?.phone || phoneAsked.current) return;
    if (!tg?.requestContact) return;
    if (localStorage.getItem('bingo_phone_asked') === '1') return;
    phoneAsked.current = true;
    localStorage.setItem('bingo_phone_asked', '1');
    try {
      tg.requestContact((shared) => {
        if (shared) {
          setTimeout(() => refreshMe(), 1800);
        }
      });
    } catch {
      /* older Telegram clients */
    }
  }, [me, refreshMe]);

  useEffect(() => {
    if (!token) return undefined;
    api('/api/game/state', { token })
      .then((state) => {
        setGame(state);
        setYou(state.you || null);
      })
      .catch(() => {});

    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('state', (state) => {
      setGame(state);
      if (state.you) setYou(state.you);
      else {
        setYou((prev) => (prev && prev.roundId !== state.id ? null : prev));
      }
    });
    socket.on('you', (payload) => setYou(payload));
    socket.on('balance', () => refreshMe());
    socket.on('game:started', () => toast('Numbers are being called. Good luck!'));
    socket.on('game:ended', (payload) => {
      const mine = youRef.current?.playerId;
      if (mine && payload.winnerIds?.includes(mine)) {
        haptic('success');
        toast('🎉 Bingo! You won this round!');
      } else {
        toast('Round finished. Next round is starting…');
      }
      api('/api/game/state', { token }).then((state) => setYou(state.you || null)).catch(() => {});
    });
    return () => socket.disconnect();
  }, [token, refreshMe, toast]);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem('bingo_voice', next ? 'on' : 'off');
    haptic('light');
  };

  const refreshGame = useCallback(async () => {
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      const state = await api('/api/game/state', { token });
      setGame(state);
      setYou(state.you || null);
      await refreshMe();
      haptic('light');
      toast('Game refreshed.');
    } catch (err) {
      toast(err.message || 'Could not refresh.', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [token, refreshing, refreshMe, toast]);

  async function join(cards) {
    setBusy(true);
    try {
      const result = await api('/api/game/join', { token, method: 'POST', body: { cards } });
      setYou({ cards: result.cards, playerId: result.playerId, roundId: game?.id, hasBingo: false, blocked: false });
      toast('You joined the round. Good luck! 🍀');
      haptic('success');
      await refreshMe();
    } catch (err) {
      toast(err.message, 'error');
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    try {
      await api('/api/game/claim', { token, method: 'POST' });
      haptic('success');
    } catch (err) {
      toast(err.message, 'error');
      haptic('error');
    } finally {
      setBusy(false);
      api('/api/game/state', { token })
        .then((state) => {
          setGame(state);
          setYou(state.you || null);
        })
        .catch(() => {});
      refreshMe();
    }
  }

  if (authError) {
    return (
      <div className="center-screen">
        <div className="fatal-card">
          <div className="brand-mark">AB</div>
          <h1>Africa Bingo</h1>
          <p>{authError}</p>
          <p className="muted small">
            Open this Mini App from the Telegram bot, or enable DEV_MODE on the server for browser testing.
          </p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="center-screen">
        <div className="loader">
          <div className="brand-mark">AB</div>
          <p>Loading Africa Bingo…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`player-shell ${me.agent ? 'with-nav' : ''}`}>
      <TopBar me={me} game={game} onRefresh={refreshGame} refreshing={refreshing} />

      {me.user?.isBanned && (
        <div className="banned-banner">Your account is suspended. Contact support on Telegram.</div>
      )}

      <main className="player-main">
        <GameScreen
          game={game}
          you={you}
          me={me}
          stake={me.config?.stake}
          onJoin={join}
          onClaim={claim}
          busy={busy}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
          voiceAvailable={me?.config?.voiceEnabled !== false}
        />
      </main>

      {me.agent && (
        <nav className="bottom-nav">
          <button type="button" className="active">
            <span>🎱</span>Game
          </button>
          <Link to="/agent" className="nav-link">
            <span>🤝</span>Agent
          </Link>
        </nav>
      )}
    </div>
  );
}
