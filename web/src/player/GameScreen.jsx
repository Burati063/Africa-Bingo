import React, { useEffect, useMemo, useRef, useState } from 'react';
import { etb, seconds } from '../format.js';
import { COLUMNS, RANGES, callLabel } from '../bingo.js';
import {
  playCallClip,
  playRemoteCall,
  preloadCallClips,
  primeVoices,
  speakCall,
  stopCallAudio,
  stopSpeaking,
} from '../voice.js';


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
              <div className="wc-winner" key={`${winner.name}-${winner.phoneMasked || winner.phone4}-${index}`}>
                {winners.length > 1 && (
                  <div className="wc-winner-head">
                    <span className="wc-winner-tag">አሸናፊ {index + 1}</span>
                  </div>
                )}
                <div className="wc-name">{winner.name}</div>
                {(winner.phoneMasked || winner.phone4) && (
                  <span className="wc-phone">
                    {winner.phoneMasked || `+251*****${winner.phone4}`}
                  </span>
                )}

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
                              {n === 0 ? 'F' : n}
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
  onPick,
  onClaim,
  busy,
  voiceOn,
  onToggleVoice,
  voiceAvailable,
  maxCards: maxCardsProp,
}) {
  const maxCards = Math.max(1, Math.min(432, Math.floor(Number(maxCardsProp) || 432)));
  const lastPlayed = useRef(null);
  // Numbers show red the instant they are tapped, before the server confirms the
  // purchase; the entry is dropped again if the join fails.
  const [pendingPicks, setPendingPicks] = useState(() => new Set());

  const called = useMemo(() => new Set(game?.calledNumbers || []), [game?.calledNumbers]);
  const callHistory = useMemo(
    () => [...(game?.calledNumbers || [])].slice(-4).reverse(),
    [game?.calledNumbers],
  );

  // Voice is Amharic only: the recorded male clip for the number plays first,
  // then the remote clip, then device speech. Used for the automatic
  // announcements while numbers are being called.
  const playCall = (number) => {
    if (!number) return;
    stopCallAudio();
    stopSpeaking();
    playCallClip(number, () => playRemoteCall(number, () => speakCall(number)));
  };

  useEffect(() => {
    primeVoices();
  }, []);

  useEffect(() => {
    if (!voiceOn || !voiceAvailable || !game?.lastCalled) return;
    if (lastPlayed.current === `${game.id}:${game.lastCalled}`) return;
    lastPlayed.current = `${game.id}:${game.lastCalled}`;
    playCall(game.lastCalled);
  }, [game?.lastCalled, game?.id, voiceOn, voiceAvailable]);

  // Mobile browsers only allow speech after a user gesture; warm the engine up
  // once so later automated calls are not silently dropped.
  useEffect(() => {
    const unlock = () => {
      preloadCallClips();
      try {
        const warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0;
        window.speechSynthesis?.speak(warm);
      } catch {
        /* unsupported */
      }
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (voiceOn) return;
    stopSpeaking();
    stopCallAudio();
  }, [voiceOn]);

  useEffect(
    () => () => {
      stopSpeaking();
      stopCallAudio();
    },
    [],
  );

  const isWaiting = game?.status === 'WAITING';
  const isCalling = game?.status === 'CALLING';
  const ended = game?.status === 'ENDED';
  const selectionMs = game?.selectionEndsInMs ?? game?.startsInMs ?? 0;
  const windowOpen = isWaiting && selectionMs > 0;
  const mySlots = you?.slots || [];
  const mySlotSet = new Set(mySlots);

  const pickSlot = async (slot) => {
    if (pendingPicks.has(slot)) return;
    setPendingPicks((prev) => new Set(prev).add(slot));
    try {
      await onPick?.(slot);
    } finally {
      setPendingPicks((prev) => {
        const next = new Set(prev);
        next.delete(slot);
        return next;
      });
    }
  };
  const takenSet = useMemo(() => new Set(game?.takenCards || []), [game?.takenCards]);
  const perCard = game?.stake || stake || 0;
  const spent = you?.spent || 0;
  const feeRate = Math.min(1, Math.max(0, Number(me?.config?.platformFeeRate ?? 0.2)));
  // The pot is recalculated on every pick: each taken card number adds one
  // stake and the platform fee is removed. This is the "game money" shown
  // live while players are selecting numbers.
  const cardsInRound = game?.takenCards?.length || 0;
  const livePool = Math.floor(cardsInRound * perCard * (1 - feeRate));
  // The real pool wins over the bot-inclusive pot, so the advertised prize and
  // the amount in the winner popup always agree. A round with no real stakes
  // (bots only) falls back to the pot every card in play forms.
  const poolDisplay = game?.prizePool || livePool || 0;
  const estimatedWin = Math.floor(poolDisplay + perCard * (1 - feeRate));

  return (
    <div className="game-screen">
      <div className="round-strip">
        {!isWaiting && (
          <span className={`status-pill ${game?.status?.toLowerCase() || ''}`}>
            {isCalling ? 'በቀጥታ' : ended ? 'ተጠናቅቋል' : 'በመገናኘት ላይ'}
          </span>
        )}
        <span className="call-count-chip">ጥሪ {game?.drawNumber || 0}/75</span>
        <span className="game-id-chip">የጨዋታ መለያ #{game?.id ?? '—'}</span>
        <span className="muted">
          {you ? `${you.cards?.length > 1 ? 'ካርዶች' : 'ካርድ'} ተገዝቷል` : 'መልካም እድል!'}
        </span>
        <span className="voice-actions">
          <button
            type="button"
            className="icon-voice"
            onClick={onToggleVoice}
            disabled={!voiceAvailable}
            title="የድምጽ ማስታወቂያ"
          >
            {voiceOn ? '🔊' : '🔇'}
          </button>
        </span>
      </div>

      {!windowOpen && (
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
              <span
                key={n}
                className={`call-chip ${game?.lastCalled === n ? 'current' : ''}`}
              >
                {callLabel(n)}
              </span>
            ))
          ) : (
            <span className="call-chip idle">--</span>
          )}
        </aside>
      </div>
      )}

      {isWaiting && (
        <div className="join-panel">
          <div className="join-head">
            <div>
              <h2>
                {windowOpen
                  ? `የመምረጫ ጊዜ በ ${countdown(selectionMs)}`
                  : 'የመምረጫ ጊዜው አልቋል — ጥሪው ይጀምራል'
                }
              </h2>
            </div>
            <div className="pool-badge">
              <span>የሽልማት ገንዘብ</span>
              <strong>{etb(poolDisplay)} ETB</strong>
            </div>
          </div>

          <div className="picks-summary">
            <div>
              <span>የመረጡት</span>
              <strong>{mySlots.length}</strong>
            </div>
            <div>
              <span>የወጣ</span>
              <strong>{etb(spent)} ETB</strong>
            </div>
            <div className="win">
              <span>የሚገመት ሽልማት</span>
              <strong>{etb(estimatedWin)} ETB</strong>
            </div>
          </div>

          {windowOpen ? (
            <div className="card-picker-wrap">
              <div className="picker-head">
                <h4>የካርድ ቁጥር ይምረጡ</h4>
                {mySlots.length ? <span>{mySlots.length} ተመርጠዋል</span> : null}
              </div>
              <div className="card-picker" role="group" aria-label="የካርድ ቁጥሮች 1 እስከ 432">
                {Array.from({ length: maxCards }, (_, i) => i + 1).map((slot) => {
                  const mine = mySlotSet.has(slot) || pendingPicks.has(slot);
                  const taken = takenSet.has(slot) && !mine;
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={`pick-cell ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}`}
                      disabled={taken || busy}
                      onClick={() => pickSlot(slot)}
                      aria-label={taken ? `ካርድ ${slot} ተመርጧል` : `ካርድ ${slot} ይግዙ`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
              {you && (
                <div className="waiting-note amharic">
                  <span className="pulse-dot" /> ተቀላቅለዋል። ተጨማሪ ካርድ መምረጥ ይችላሉ — ጊዜው እስኪያልቅ።
                </div>
              )}
            </div>
          ) : (
            <div className="waiting-note amharic">
              <span className="pulse-dot" /> የመምረጫ ጊዜው አልቋል። ካርዶችዎ ከዚህ በታች ይታያሉ — ጥሪው ይጀምራል።
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
                <span className="bingo-hint">
                  መግቢያ {etb(you.spent || 0)} ETB · ሽልማት {etb(poolDisplay)} ETB
                </span>
                {you.hasBingo && <span className="bingo-hint">መስመር ሙሉ ነው — ይጠይቁ!</span>}
                {you.blocked && <span className="blocked-hint">የተሳሳተ ጥያቄ። በዚህ ዙር ማመልከት አይችሉም።</span>}
              </div>
            </>
          ) : (
            <div className="waiting-note amharic">
              ይህ ዙር በቀጥታ እየተካሄደ ነው። ለቀጣዩ ዙር ይዘጋጁ፡፡
            </div>
          )}
        </div>
      )}

      {you?.cards?.length > 0 && !windowOpen && (
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
                            {n === 0 ? 'F' : n}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                  <div className="bingo-card-foot">
                    <span>ካርድ #{you.slots?.[index] ?? index + 1}</span>
                    <span className="card-win">ሽልማት {etb(poolDisplay)} ETB</span>
                  </div>
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
