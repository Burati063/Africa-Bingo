import React from 'react';
import { etb } from '../format.js';
import { callLabel } from '../bingo.js';

export default function TopBar({ me, game, onRefresh, refreshing }) {
  const statusText =
    game?.status === 'CALLING'
      ? `${game.calledNumbers?.length || 0} numbers called`
      : game?.status === 'WAITING'
        ? 'Round open — buy a card'
        : game?.status === 'ENDED'
          ? 'Round finished'
          : 'Connecting…';

  return (
    <header className="topbar">
      <div className="brand-row">
        <div className="brand-lockup">
          <span className="brand-mark small">AB</span>
          <div>
            <strong className="brand-title">Africa Bingo</strong>
            <span className="brand-sub">Game ID #{game?.id ?? '—'}</span>
          </div>
        </div>
        <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
          <span aria-hidden="true">↻</span> {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="topbar-row">
        <div className="stat balance-stat">
          <span>Balance</span>
          <strong>
            {etb(me?.balance)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat">
          <span>Stake</span>
          <strong>
            {etb(game?.stake)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat game-id-stat">
          <span>Game ID</span>
          <strong>#{game?.id ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Prize</span>
          <strong>{etb(game?.prizePool)}</strong>
        </div>
      </div>

      <div className="call-strip">
        <span className="call-label">Call</span>
        <span className={`call-ball ${game?.lastCalled ? 'live' : ''}`}>
          {game?.lastCalled ? callLabel(game.lastCalled) : '--'}
        </span>
        <span className="call-meta">{statusText}</span>
      </div>
    </header>
  );
}
