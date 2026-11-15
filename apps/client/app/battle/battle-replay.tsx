'use client';
// Full-screen battle replay. Animation only: every number here comes from the server's round log.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { art } from '../../lib/api';
import { DecodeText, GlitchOverlay } from '../pack-fx';
import '../pack-fx.css';
import type { Battle, BattleRound, LineupCard, RoundSide } from './types';

type Phase = 'intro' | 'call' | 'enter' | 'base' | 'bonus' | 'swing' | 'trick' | 'clutch' | 'total' | 'result';
interface Step { round: number; phase: Phase }
const DUR: Record<Phase, number> = { intro: 1900, call: 1150, enter: 650, base: 650, bonus: 750, swing: 850, trick: 950, clutch: 1200, total: 1400, result: 0 };
const ORDER: Phase[] = ['call', 'enter', 'base', 'bonus', 'swing', 'trick', 'clutch', 'total'];
const RARITY_COLOR = { common: '#A4A4AA', rare: '#3D9BFF', epic: '#A35CFF', legendary: '#F5B941' };
const TIER_NAMES = ['Rookie', 'Pro', 'Elite', 'Legend'];
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const bonusSum = (s: RoundSide) => s.bonuses.reduce((a, b) => a + b.value, 0);
function extras(s: RoundSide) {
  const pre = s.base + bonusSum(s) + s.swing;
  const trick = typeof s.trickshot === 'number' ? s.trickshot : 0;
  const clutch = typeof s.clutch === 'number' ? s.clutch : s.clutch ? s.total - pre - trick : 0;
  // A flag-only trickshot: whatever is left after base, bonuses, swing and clutch.
  const trickV = s.trickshot === true ? s.total - pre - clutch : trick;
  return { trick: trickV, clutch, hasTrick: !!s.trickshot, hasClutch: !!s.clutch };
}
function valueAt(s: RoundSide, p: Phase): number | null {
  const i = ORDER.indexOf(p), e = extras(s);
  if (p === 'result') return s.total;
  if (i < ORDER.indexOf('base')) return null;
  let v = s.base;
  if (i >= ORDER.indexOf('bonus')) v += bonusSum(s);
  if (i >= ORDER.indexOf('swing')) v += s.swing;
  if (i >= ORDER.indexOf('trick')) v += e.trick;
  if (i >= ORDER.indexOf('clutch')) v = s.total;
  return v;
}

function Count({ value }: { value: number | null }) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return;
    if (reduced()) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current, d = 420;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / d), v = Math.round(a + (value - a) * (1 - (1 - k) ** 3));
      setShown(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{value == null ? '–' : shown}</>;
}

function Face({ entry, side, small }: { entry: LineupCard; side: 'player' | 'opponent'; small?: boolean }) {
  return <span className={`bc-face fx-r-${entry.card.rarity}${small ? ' is-small' : ''} side-${side}`} style={{ '--rarity-glow': RARITY_COLOR[entry.card.rarity] } as CSSProperties}>
    <img src={art(entry.card.artUrl)} alt={entry.card.name} />
    <span className="bc-face-label"><small>{entry.card.fazeMember}{entry.serial ? ` · #${entry.serial}` : ''}</small><b>{entry.card.name}</b></span>
    <span className="bc-face-rarity">{entry.card.rarity}</span>
  </span>;
}

function Side({ who, round, phase, entry }: { who: 'player' | 'opponent'; round: BattleRound; phase: Phase; entry: LineupCard }) {
  const s = round[who], e = extras(s), at = ORDER.indexOf(phase);
  const won = phase === 'total' && round.winner === who, lost = phase === 'total' && round.winner !== who && round.winner !== 'tie';
  return <div className={`bc-side side-${who}${won ? ' is-winner' : ''}${lost ? ' is-loser' : ''}${phase === 'trick' && e.hasTrick ? ' is-trick' : ''}${phase === 'clutch' && e.hasClutch ? ' is-clutch' : ''}`}>
    <div className="bc-side-card">{phase === 'trick' && e.hasTrick && <span className="bc-rays" aria-hidden="true" />}<Face entry={entry} side={who} />
      {phase === 'trick' && e.hasTrick && <span className="bc-stamp bc-stamp-trick">TRICKSHOT! +{e.trick}</span>}
      {phase === 'clutch' && e.hasClutch && <span className="bc-stamp bc-stamp-clutch">CLUTCH +{e.clutch}</span>}
      {won && <span className="bc-stamp bc-stamp-win">+{round.points} PT{round.points > 1 ? 'S' : ''}</span>}
    </div>
    <div className="bc-number" aria-hidden="true"><Count value={valueAt(s, phase)} /></div>
    <ul className="bc-chips">
      {at >= ORDER.indexOf('base') && <li className="is-base">{round.stat} {s.base}</li>}
      {at >= ORDER.indexOf('bonus') && s.bonuses.map(b => <li key={b.label}>{b.label} +{b.value}</li>)}
      {at >= ORDER.indexOf('swing') && <li className="is-swing">Swing +{s.swing}</li>}
      {at >= ORDER.indexOf('trick') && e.hasTrick && <li className="is-trick">Trickshot +{e.trick}</li>}
      {at >= ORDER.indexOf('clutch') && e.hasClutch && <li className="is-clutch">Clutch +{e.clutch}</li>}
    </ul>
  </div>;
}

export default function BattleReplay({ battle, onClose }: { battle: Battle; onClose: () => void }) {
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ round: -1, phase: 'intro' }];
    battle.rounds.forEach((r, i) => {
      const any = (k: 'hasTrick' | 'hasClutch') => extras(r.player)[k] || extras(r.opponent)[k];
      for (const phase of ORDER) {
        if (phase === 'trick' && !any('hasTrick')) continue;
        if (phase === 'clutch' && !any('hasClutch')) continue;
        out.push({ round: i, phase });
      }
    });
    out.push({ round: battle.rounds.length, phase: 'result' });
    return out;
  }, [battle]);
  const last = steps.length - 1;
  const [step, setStep] = useState(() => reduced() ? last : 0);
  const [glitchKey, setGlitchKey] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const cur = steps[step];
  const round = battle.rounds[cur.round] as BattleRound | undefined;

  useEffect(() => {
    if (cur.phase === 'result') return;
    const t = setTimeout(() => setStep(s => Math.min(last, s + 1)), DUR[cur.phase]);
    return () => clearTimeout(t);
  }, [step, cur.phase, last]);
  useEffect(() => { if (cur.phase === 'clutch') setGlitchKey(step); }, [cur.phase, step]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (!buttons.length) return;
      const first = buttons[0], end = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); end.focus(); }
      else if (!event.shiftKey && (document.activeElement === end || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);

  const doneRounds = battle.rounds.filter((_, i) => i < cur.round || (i === cur.round && cur.phase === 'total'));
  const pts = (who: 'player' | 'opponent') => cur.phase === 'result' ? (who === 'player' ? battle.playerPoints : battle.opponentPoints) : doneRounds.reduce((s, r) => s + (r.winner === who ? r.points : 0), 0);
  const totals = (who: 'player' | 'opponent') => battle.rounds.reduce((s, r) => s + r[who].total, 0);
  const win = battle.result === 'win';
  const title = battle.mode === 'vault' ? `VAULT · TIER ${battle.tier ?? ''} ${TIER_NAMES[(battle.tier ?? 0) - 1]?.toUpperCase() ?? ''}` : battle.mode === 'practice' ? 'PRACTICE · NO REWARDS' : 'BATTLE';
  const glitching = glitchKey !== null && cur.phase === 'clutch';
  const announce = cur.phase === 'total' && round ? `Round ${round.n}: ${round.winner === 'tie' ? 'tie' : round.winner === 'player' ? 'you win' : `${battle.opponent.name} wins`}. ${round.player.total} to ${round.opponent.total}.` : cur.phase === 'result' ? `${win ? 'Victory' : 'Defeat'}, ${battle.playerPoints} to ${battle.opponentPoints}.` : '';

  // Portaled to <body> like the pack reveal, so main's polish rules never reach the cinema.
  return createPortal(<div className={`battle-cinema phase-${cur.phase}${glitching ? ' fx-glitching fx-gl-legendary' : ''}${cur.phase === 'result' ? (win ? ' is-win' : ' is-loss') : ''}`} style={{ '--rarity-glow': '#E4002B' } as CSSProperties}>
    <div ref={panel} tabIndex={-1} className="bc-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-title">
      <div className="bc-top"><span id="bc-title">FAZE VAULT / {title}</span><button onClick={onClose} aria-label="Close battle replay">Close ×</button></div>

      <div className="bc-score" aria-label={`Score: you ${pts('player')}, ${battle.opponent.name} ${pts('opponent')}`}>
        <div className="bc-team side-player"><small>YOU</small><b>{battle.player.name}</b></div>
        <div className="bc-points"><span key={`p${pts('player')}`}>{pts('player')}</span><i>–</i><span key={`o${pts('opponent')}`}>{pts('opponent')}</span></div>
        <div className="bc-team side-opponent"><small>OPPONENT</small><b>{battle.opponent.name}</b></div>
        <ol className="bc-pips" aria-hidden="true">{battle.rounds.map((r, i) => { const done = doneRounds.includes(r) || cur.phase === 'result'; return <li key={r.n} className={`${i === cur.round && cur.phase !== 'result' ? 'is-now ' : ''}${done ? `w-${r.winner}` : ''}`}>R{r.n}<small>{r.points}PT</small></li>; })}</ol>
      </div>

      {cur.phase === 'intro' && <div className="bc-faceoff">
        <div className="bc-row side-opponent">{battle.opponent.lineup.map((x, i) => <span key={i} style={{ '--i': i } as CSSProperties}><Face entry={x} side="opponent" small /></span>)}</div>
        <div className="bc-vs"><b>VS</b><small>3 lanes · 4 points on the line</small></div>
        <div className="bc-row side-player">{battle.player.lineup.map((x, i) => <span key={i} style={{ '--i': i } as CSSProperties}><Face entry={x} side="player" small /></span>)}</div>
      </div>}

      {round && cur.phase !== 'intro' && cur.phase !== 'result' && <div className="bc-round" key={round.n}>
        <p className="bc-call"><small>ROUND {round.n} · {round.slot}{round.points > 1 ? ` · ${round.points} PTS` : ''}</small><b data-stat={round.stat}><DecodeText text={round.stat.toUpperCase()} play /></b></p>
        {cur.phase !== 'call' && <div className="bc-lane">
          <Side who="player" round={round} phase={cur.phase} entry={battle.player.lineup[round.player.cardIndex] ?? battle.player.lineup[cur.round]} />
          <span className="bc-lane-vs" aria-hidden="true">VS</span>
          <Side who="opponent" round={round} phase={cur.phase} entry={battle.opponent.lineup[round.opponent.cardIndex] ?? battle.opponent.lineup[cur.round]} />
        </div>}
      </div>}

      {cur.phase === 'result' && <div className="bc-result">
        <p className="eyebrow">{battle.mode === 'practice' ? 'PRACTICE RESULT' : 'FINAL'}</p>
        <h2 className="bc-verdict" data-text={win ? 'VICTORY' : 'DEFEAT'}>{win ? 'VICTORY' : 'DEFEAT'}</h2>
        <p className="bc-final">{battle.playerPoints} – {battle.opponentPoints} <small>{battle.playerPoints === battle.opponentPoints ? 'Points level, decided on totals' : 'points'} · totals {totals('player')} vs {totals('opponent')}</small></p>
        <div className="bc-rewards">
          <span className={`bc-xp${battle.rewards.xp ? ' is-on' : ''}`}><small>XP GAINED</small><b>+{battle.rewards.xp}</b></span>
          {battle.rewards.badge && <span className="bc-badge"><small>BADGE UNLOCKED</small><b>{battle.rewards.badge}</b></span>}
          {!battle.rewards.xp && !battle.rewards.badge && <small className="bc-norew">{battle.mode === 'practice' ? 'Practice gives no rewards.' : win ? 'Already cleared today: no new rewards.' : 'No rewards this time. Tweak the lineup and go again.'}</small>}
        </div>
        <table className="bc-table"><caption className="fx-sr">Round by round</caption>
          <thead><tr><th scope="col">Round</th><th scope="col">Stat</th><th scope="col">You</th><th scope="col">Opp.</th><th scope="col">Pts</th></tr></thead>
          <tbody>{battle.rounds.map(r => <tr key={r.n} className={`w-${r.winner}`}><th scope="row">{r.n} · {r.slot}</th><td>{r.stat}</td>
            <td>{r.player.total}{extras(r.player).hasTrick ? ' ⚡' : ''}{extras(r.player).hasClutch ? ' ▲' : ''}</td><td>{r.opponent.total}{extras(r.opponent).hasTrick ? ' ⚡' : ''}{extras(r.opponent).hasClutch ? ' ▲' : ''}</td>
            <td>{r.winner === 'tie' ? '–' : `${r.winner === 'player' ? 'You' : 'Opp'} +${r.points}`}</td></tr>)}</tbody>
        </table>
        <small className="bc-seed">Server-resolved · seed {battle.seed} · ⚡ Trickshot ▲ Clutch</small>
      </div>}

      <div className="bc-controls">
        {cur.phase !== 'result' ? <button onClick={() => setStep(last)}>Skip ⏭</button> : <button onClick={() => setStep(0)}>↺ Watch replay</button>}
        <button className={cur.phase === 'result' ? 'primary' : ''} onClick={onClose}>{cur.phase === 'result' ? 'Back to lineup' : 'Close'}</button>
      </div>
      <p className="fx-sr" aria-live="polite">{announce}</p>
    </div>
    {glitching && <GlitchOverlay key={glitchKey} level="legendary" onDone={() => setGlitchKey(null)} />}
  </div>, document.body);
}
