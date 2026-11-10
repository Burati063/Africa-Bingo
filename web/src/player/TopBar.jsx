import React from 'react';
import { etb } from '../format.js';
import { callLabel } from '../bingo.js';

export default function TopBar({ me, game, onRefresh, refreshing }) {
  const statusText =
    game?.status === 'CALLING'
      ? `${game.calledNumbers?.length || 0} ቁጥሮች ተጠርተዋል`
      : game?.status === 'WAITING'
        ? 'ዙር ክፍት ነው — ካርድ ይግዙ'
        : game?.status === 'ENDED'
          ? 'ዙሩ ተጠናቅቋል'
          : 'በመገናኘት ላይ…';

  return (
    <header className="topbar">
      <div className="brand-row">
        <div className="brand-lockup">
          <span className="brand-mark small">AB</span>
          <div>
            <strong className="brand-title">Africa Bingo</strong>
            <span className="brand-sub">የጨዋታ መለያ #{game?.id ?? '—'}</span>
          </div>
        </div>
        <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
          <span aria-hidden="true">↻</span> {refreshing ? 'በማደስ ላይ' : 'አድስ'}
        </button>
      </div>

      <div className="topbar-row">
        <div className="stat balance-stat">
          <span>ቀሪ ሂሳብ</span>
          <strong>
            {etb(me?.balance)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat">
          <span>መግቢያ ክፍያ</span>
          <strong>
            {etb(game?.stake)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat game-id-stat">
          <span>የጨዋታ መለያ</span>
          <strong>#{game?.id ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>ሽልማት</span>
          <strong>{etb(game?.prizePool)}</strong>
        </div>
      </div>

      <div className="call-strip">
        <span className="call-label">ጥሪ</span>
        <span className={`call-ball ${game?.lastCalled ? 'live' : ''}`}>
          {game?.lastCalled ? callLabel(game.lastCalled) : '--'}
        </span>
        <span className="call-meta amharic">{statusText}</span>
      </div>
    </header>
  );
}
