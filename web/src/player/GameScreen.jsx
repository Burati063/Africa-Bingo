import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { etb, seconds } from '../format.js';
import { COLUMNS, RANGES, callLabel } from '../bingo.js';


function countdown(ms) {
  const total = seconds(ms);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const LINES = (() => {
  const lines = [];
  for (let row = 0; row < 5; row += 1) {
    lines.push(Array.from({ length: 5 }, (_, col) => [col, row]));
  }
  for (let col = 0; col < 5; col += 1) {
    lines.push(Array.from({ length: 5 }, (_, row) => [col, row]));
  }
  lines.push(Array.from({ length: 5 }, (_, i) => [i, i]));
  lines.push(Array.from({ length: 5 }, (_, i) => [i, 4 - i]));
  return lines;
})();

function lineFor(card, called) {
  return (
    LINES.find((line) =>
      line.every(([col, row]) => {
        const n = card[col]?.[row];
        return n === 0 || called.has(n);
      }),
    ) || null
  );
}

function WinnerOverlay({ game, you }) {
  const winners = game?.winners || [];
  if (!winners.length) return null;

  const called = new Set(game?.calledNumbers || []);

  return (
    <div className="winner-overlay" role="dialog" aria-label="የቢንጎ አሸናፊዎች">
      <div className="winner-card">
        <div className="wc-sparkle">🎉</div>
        <h2 className="wc-title">BINGO</h2>
        {winners.length > 1 && (
          <div className="wc-count">{winners.length} አሸናፊዎች በዚህ ዙር</div>
        )}

        <div className="wc-winners">
          {winners.map((winner, index) => {
            const lineSet = new Set((winner.line || []).map(([col, row]) => `${col}-${row}`));
            return (
              <div className="wc-winner" key={`${winner.name}-${winner.phone4}-${index}`}>
                {winners.length > 1 && (
                  <div className="wc-winner-head">
                    <span className="wc-winner-tag">አሸናፊ {index + 1}</span>
                  </div>
                )}
                <div className="wc-name">
                  {winner.name}
                  {winner.phone4 ? <span> · {winner.phone4}</span> : null}
                </div>

                {winner.card ? (
                  <>
                    <div className="wc-letters">
                      {COLUMNS.map((letter) => (
                        <span key={letter}>{letter}</span>
                      ))}
                    </div>
                    <div className="wc-grid">
                      {Array.from({ length: 5 }, (_, row) =>
                        COLUMNS.map((_, col) => {
                          const n = winner.card[col]?.[row];
                          const marked = n === 0 || called.has(n);
                          const selected = lineSet.has(`${col}-${row}`);
                          return (
                            <span
                              key={`${col}-${row}`}
                              className={`wc-cell ${marked ? 'marked' : ''} ${selected ? 'selected' : ''} ${n === 0 ? 'free' : ''}`}
                            >
                              {n === 0 ? '★' : n}
                            </span>
                          );
                        }),
                      )}
                    </div>
                  </>
                ) : null}

                <div className="wc-foot">
                  <span>
                    ሽልማት <strong>{etb(winner.amount)} ETB</strong>
                  </span>
                  <span>ካርድ #{winner.cardNumber}</span>
                </div>
              </div>
            );
          })}
        </div>

        {you?.isWinner && <div className="wc-you">አሸንፈዋል {etb(you.winAmount)} ETB</div>}
        <div className="wc-next">ቀጣዩ ዙር በ {countdown(game?.nextRoundInMs)}…</div>
      </div>
    </div>
  );
}

export default function GameScreen({
  game,
  you,
  me,
  stake,
  onJoin,
  onClaim,
  busy,
  voiceOn,
  onToggleVoice,
  voiceAvailable,
}) {
  const [cards, setCards] = useState(1);
  const [voiceFiles, setVoiceFiles] = useState({});
  const lastPlayed = useRef(null);
  const audioRef = useRef(null);

  const called = useMemo(() => new Set(game?.calledNumbers || []), [game?.calledNumbers]);
  const callHistory = useMemo(
    () => [...(game?.calledNumbers || [])].slice(-8).reverse(),
    [game?.calledNumbers],
  );

  useEffect(() => {
    api('/api/voice-files')
      .then((files) => {
        const map = {};
        for (const file of files) map[file.key] = file.fileUrl;
        setVoiceFiles(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!voiceOn || !voiceAvailable || !game?.lastCalled) return;
    if (lastPlayed.current === `${game.id}:${game.lastCalled}`) return;
    lastPlayed.current = `${game.id}:${game.lastCalled}`;
    const url = voiceFiles[`num_${game.lastCalled}`];
    if (!url) return;
    try {
      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      audioRef.current.play().catch(() => {});
    } catch {
      /* autoplay may be blocked until first interaction */
    }
  }, [game?.lastCalled, game?.id, voiceOn, voiceAvailable, voiceFiles]);

  const canJoin = !you && game?.status === 'WAITING';
  const totalPrice = (game?.stake || stake || 0) * cards;
  const isWaiting = game?.status === 'WAITING';
  const isCalling = game?.status === 'CALLING';
  const ended = game?.status === 'ENDED';

  return (
    <div className="game-screen">
      <div className="round-strip">
        <span className={`status-pill ${game?.status?.toLowerCase() || ''}`}>
          {isWaiting ? 'ዙር ክፍት' : isCalling ? 'በቀጥታ' : ended ? 'ተጠናቅቋል' : 'በመገናኘት ላይ'}
        </span>
        <span className="game-id-chip">የጨዋታ መለያ #{game?.id ?? '—'}</span>
        <span className="muted">
          {you ? `${you.cards?.length > 1 ? 'ካርዶች' : 'ካርድ'} ተገዝቷል` : 'መልካም እድል!'}
        </span>
        <button
          type="button"
          className="icon-voice"
          onClick={onToggleVoice}
          disabled={!voiceAvailable}
          title="የድምጽ ማስታወቂያ"
        >
          {voiceOn ? '🔊' : '🔇'}
        </button>
      </div>

      <div className="board-wrap">
        <section className="master-board" aria-label="የቢንጎ ሰሌዳ">
          {COLUMNS.map((letter, colIndex) => (
            <div className="board-col" key={letter}>
              <div className="board-head">{letter}</div>
              {Array.from({ length: 15 }, (_, i) => {
                const n = RANGES[colIndex][0] + i;
                const isCalled = called.has(n);
                return (
                  <div
                    key={n}
                    className={`board-num ${isCalled ? 'called' : ''} ${game?.lastCalled === n ? 'current' : ''}`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <aside className="call-rail" aria-label="የቅርብ ጥሪዎች">
          <span className="call-rail-title">ጥሪዎች</span>
          {callHistory.length ? (
            callHistory.map((n) => (
              <span key={n} className={`call-chip ${game?.lastCalled === n ? 'current' : ''}`}>
                {callLabel(n)}
              </span>
            ))
          ) : (
            <span className="call-chip idle">--</span>
          )}
        </aside>
      </div>

      {isWaiting && (
        <div className="join-panel">
          <div className="join-head">
            <div>
              <p className="eyebrow">የመግቢያ ክፍያ በካርድ {etb(game?.stake)} ETB</p>
              <h2>ቀጣዩ ዙር በ {countdown(game?.startsInMs)} ይጀምራል</h2>
            </div>
            <div className="pool-badge">
              <span>የሽልማት ገንዘብ</span>
              <strong>{etb(game?.prizePool)} ETB</strong>
            </div>
          </div>

          {!you ? (
            <>
              <div className="card-picker">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`pick ${cards === n ? 'active' : ''}`}
                    onClick={() => setCards(n)}
                  >
                    <strong>{n}</strong>
                    <span>{n > 1 ? 'ካርዶች' : 'ካርድ'}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn primary big"
                disabled={busy || !canJoin}
                onClick={() => onJoin(cards)}
              >
                {busy ? 'በመቀላቀል ላይ…' : `ዙሩን ተቀላቀሉ — ${etb(totalPrice)} ETB`}
              </button>
              <p className="fine-print amharic">ቀሪ ሂሳብ፦ {etb(me?.balance)} ETB</p>
            </>
          ) : (
            <div className="waiting-note amharic">
              <span className="pulse-dot" /> ተቀላቅለዋል። ቁጥሮች በራስ-ሰር ይጠራሉ።
            </div>
          )}
        </div>
      )}

      {isCalling && (
        <div className="action-panel">
          {you ? (
            <>
              <button
                type="button"
                className={`btn bingo-btn ${you.hasBingo ? 'ready' : ''}`}
                disabled={busy || you.blocked}
                onClick={onClaim}
              >
                {you.blocked ? 'ተከልክለዋል' : you.hasBingo ? 'ቢንጎ! አሁን ይጠይቁ' : 'ቢንጎ!'}
              </button>
              <div className="call-timer amharic">
                ቀጣዩ ቁጥር በ <strong>{seconds(game?.nextCallInMs)} ሰከንድ</strong>
                {you.hasBingo && <span className="bingo-hint">መስመር ሙሉ ነው — ይጠይቁ!</span>}
                {you.blocked && <span className="blocked-hint">የተሳሳተ ጥያቄ። በዚህ ዙር ማመልከት አይችሉም።</span>}
              </div>
            </>
          ) : (
            <div className="waiting-note amharic">
              ይህ ዙር በቀጥታ እየተካሄደ ነው። ለቀጣዩ ዙር ካርድ ይግዙ።
            </div>
          )}
        </div>
      )}

      {you?.cards?.length > 0 && (
        <section className="my-cards">
          <div className="section-title">
            <h3>የእኔ {you.cards.length > 1 ? 'ካርዶች' : 'ካርድ'}</h3>
            <span className="muted amharic">{you.hasBingo ? 'መስመር ተሞልቷል!' : 'ራስ-ሰር ምልክት በርቷል'}</span>
          </div>
          <div className="card-scroll">
            {you.cards.map((card, index) => {
              const winLine = lineFor(card, called);
              const winSet = new Set((winLine || []).map(([col, row]) => `${col}-${row}`));
              return (
                <div className={`bingo-card ${winLine ? 'winning' : ''}`} key={index}>
                  <div className="bingo-card-head">
                    {COLUMNS.map((letter) => (
                      <span key={letter}>{letter}</span>
                    ))}
                  </div>
                  {Array.from({ length: 5 }, (_, row) => (
                    <div className="bingo-card-row" key={row}>
                      {COLUMNS.map((_, col) => {
                        const n = card[col][row];
                        const marked = n === 0 || called.has(n);
                        const selected = winSet.has(`${col}-${row}`);
                        return (
                          <span
                            key={col}
                            className={`bingo-cell ${marked ? 'marked' : ''} ${selected ? 'selected' : ''} ${n === 0 ? 'free' : ''}`}
                          >
                            {n === 0 ? '★' : n}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                  <div className="bingo-card-foot">ካርድ {index + 1}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!you && isCalling && (
        <section className="spectator">
          <p className="amharic">ይህን ዙር እየተመለከቱ ነው። ቀጣዩ ዙር በራሱ ይከፈታል።</p>
        </section>
      )}

      {ended && <WinnerOverlay game={game} you={you} />}
    </div>
  );
}
