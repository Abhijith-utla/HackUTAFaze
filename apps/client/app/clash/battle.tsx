'use client';
// The battle table. Top: scoreboard + the current prompt. Middle: the cards in play. Bottom: your hand. You pick the card that best
// matches the prompt; the server scores both sides by tag match and the higher score wins the round (a point). Best of five.
import type { ClashClip, ClashState } from '@faze/shared';
import { useEffect, useRef } from 'react';
import { thumb } from '../../lib/api';
import type { Opponent } from './opponent';
import { derive, roundResult, weightList, type PipState, type RoundResult, type Side } from './view';

const PIP_LABEL: Record<PipState, string> = { win: 'won', loss: 'lost', draw: 'drawn', current: 'in play', pending: 'upcoming', skipped: 'not needed' };

function Face({ card, className = '' }: { card: ClashClip; className?: string }) {
  return <span className={`cg-face ${className}`}><img src={thumb(card.art_url, 360)} alt={card.name} loading="lazy" decoding="async" /></span>;
}
const Back = () => <span className="cg-back" aria-hidden="true"><b>F</b></span>;

function Pips({ pips }: { pips: PipState[] }) {
  return <ol className="cg-pips" aria-label="Rounds">{pips.map((p, i) => <li key={i} className={`cg-pip is-${p}`} aria-label={`Round ${i + 1}: ${PIP_LABEL[p]}`}>{p === 'win' ? '✓' : p === 'loss' ? '✕' : p === 'draw' ? '–' : i + 1}</li>)}</ol>;
}

function Score({ who, name, sub, points }: { who: 'me' | 'opp'; name: string; sub?: string; points: number }) {
  return <div className={`cg-side is-${who}`}><small>{name}{sub && <em> · {sub}</em>}</small><b aria-label={`${who === 'me' ? 'You' : 'Opponent'}: ${points} points`}>{points}</b></div>;
}

function Prompt({ title, description, weights, round }: { title: string; description: string; weights: Record<string, number>; round: number }) {
  return <div className="cg-prompt" role="status" aria-live="polite">
    <p className="cg-eyebrow">ROUND {round} OF 5 · THE PROMPT</p>
    <h3>{title}</h3>
    <p>{description} <span>Play the card closest to this.</span></p>
    <ul aria-label="Tags this prompt rewards">{weightList(weights).map(([t, w]) => <li key={t}><b>{t}</b> +{w}</li>)}</ul>
  </div>;
}

function Played({ side, label, win, lose }: { side: Side | null; label: string; win?: boolean; lose?: boolean }) {
  return <figure className={`cg-played${win ? ' is-win' : ''}${lose ? ' is-lose' : ''}`}>
    {side ? <Face card={side.card} /> : <span className="cg-slot" aria-hidden="true" />}
    <figcaption><small>{label}</small>{side && <><strong>{side.card.name}</strong><span className="cg-pts"><b>{side.score}</b> pts</span>
      <span className="cg-hit">{side.matches.length ? side.matches.map((m) => `${m.tag} +${m.points}`).join(' · ') : 'no matching tags'}</span></>}</figcaption>
  </figure>;
}

function Reveal({ r, last, onContinue, opponent }: { r: RoundResult; last: boolean; onContinue: () => void; opponent: Opponent }) {
  const msg = r.winner === 'me' ? 'ROUND WON · +1 POINT' : r.winner === 'opp' ? 'ROUND LOST · POINT TO THEM' : 'DRAW · NO POINT';
  return <section className={`cg-reveal is-${r.winner ?? 'none'}`} aria-live="polite">
    <p className="cg-banner" role="status">{msg}</p>
    {r.tiebreak ? <p className="cg-why">Both cards matched the prompt equally ({r.mine?.score ?? 0} – {r.theirs?.score ?? 0}), so the stronger card wins: <b>{r.tiebreak.mine}</b> vs <b>{r.tiebreak.theirs}</b> power.</p>
      : r.winner === 'draw' ? <p className="cg-why">Equal match and equal power: nobody scores.</p>
      : <p className="cg-why">The closer match to “{r.title}” wins the point.</p>}
    <div className="cg-versus">
      <Played side={r.mine} label="YOUR CARD" win={r.winner === 'me'} lose={r.winner === 'opp'} />
      <span className="cg-vs" aria-hidden="true">VS</span>
      <Played side={r.theirs} label={`${opponent.handle.toUpperCase()}'S CARD`} win={r.winner === 'opp'} lose={r.winner === 'me'} />
    </div>
    <button type="button" className="cg-primary" onClick={onContinue} autoFocus>{last ? 'See the result →' : 'Next round →'}</button>
  </section>;
}

function Final({ state, opponent, onAgain }: { state: ClashState; opponent: Opponent; onAgain: () => void }) {
  const v = derive(state);
  const rounds = state.rounds.map((r) => roundResult(state, r.number)).filter(Boolean) as RoundResult[];
  const title = v.outcome === 'win' ? 'VICTORY' : v.outcome === 'loss' ? 'DEFEAT' : 'DRAW';
  return <section className={`cg-final is-${v.outcome}`} aria-live="polite">
    <p className="cg-eyebrow">MATCH OVER · vs {opponent.handle} · {opponent.city} (demo: computer)</p>
    <h2>{title}</h2>
    <p className="cg-final-score"><b>{v.myScore}</b> <span>–</span> <b>{v.oppScore}</b></p>
    <ol className="cg-recap">{rounds.map((r) => <li key={r.number} className={`is-${r.winner}`}>
      <span className="cg-recap-n">R{r.number}</span><span className="cg-recap-t"><b>{r.title}</b></span>
      <span>{r.mine?.card.name ?? '—'} <b>{r.mine?.score ?? 0}</b></span><span className="cg-recap-vs">vs</span><span>{r.theirs?.card.name ?? '—'} <b>{r.theirs?.score ?? 0}</b></span>
      <span className="cg-recap-res">{r.winner === 'me' ? 'WON' : r.winner === 'opp' ? 'LOST' : 'DRAW'}{r.tiebreak && <small title="Tied on tags, decided by card power"> ·power</small>}</span></li>)}</ol>
    <button type="button" className="cg-primary" onClick={onAgain} autoFocus>Play again</button>
  </section>;
}

export default function Battle({ state, opponent, selected, onSelect, onPlay, busy, reveal, onContinue, onLeave, onAgain }: {
  state: ClashState; opponent: Opponent; selected: string | null; onSelect: (id: string | null) => void; onPlay: () => void; busy: boolean;
  reveal: number | null; onContinue: () => void; onLeave: () => void; onAgain: () => void;
}) {
  const table = useRef<HTMLDivElement>(null);
  // Bring the table to the top of the screen once, so the whole match is in view without scrolling.
  useEffect(() => { table.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, []);

  const v = derive(state);
  const revealed = reveal !== null ? roundResult(state, reveal) : null;
  const showFinal = v.status === 'completed' && reveal === null;
  const promptRound = revealed ?? (v.current ? roundResult(state, v.current.number) : null) ?? (showFinal ? roundResult(state, state.rounds.length) : null);
  const canPlay = v.status === 'active' && !!v.current && reveal === null && !v.current.submissions.some((s) => s.seat === v.me);

  return <div ref={table} className="cg-table cg-battle" data-phase={showFinal ? 'final' : revealed ? 'reveal' : 'play'}>
    <aside className="cg-col cg-col-me" aria-label="Your team">
      <Score who="me" name="YOU" points={v.myScore} />
      <p className="cg-col-title">YOUR TEAM</p>
      <ul className="cg-grid">{v.myLineup.map((c) => {
        const used = c.id in v.myUsed, on = selected === c.id;
        return <li key={c.id}><button type="button" className={`cg-hcard${on ? ' is-on' : ''}${used ? ' is-used' : ''}`} disabled={!canPlay || used || busy} aria-pressed={on}
          onClick={() => onSelect(on ? null : c.id)} title={`${c.name} · ${c.moment_tags.join(', ')}`}>
          <Face card={c} />
          <span className="cg-hname">{c.name}</span>
          <span className="cg-htags">{used ? `played in round ${v.myUsed[c.id]}` : c.moment_tags.join(' · ')}</span>
        </button></li>;
      })}</ul>
    </aside>

    <section className="cg-center" aria-live="polite">
      <div className="cg-mid"><small>BEST OF 5 · FIRST TO 3</small><Pips pips={v.pips} /></div>
      {promptRound && !showFinal && <Prompt title={promptRound.title} description={promptRound.description} weights={promptRound.weights} round={promptRound.number} />}
      <div className="cg-stage">
      {showFinal ? <Final state={state} opponent={opponent} onAgain={onAgain} />
        : revealed ? <Reveal r={revealed} last={v.status === 'completed' && reveal === state.rounds.length} onContinue={onContinue} opponent={opponent} />
        : <div className="cg-play">
            <p className="cg-center-hint">{canPlay ? (selected ? 'Locked and loaded. Play it!' : 'Pick the card that best fits the prompt.') : 'Resolving…'}</p>
            <div className="cg-actions">
              <button type="button" className="cg-primary" disabled={!canPlay || !selected || busy} onClick={onPlay}>{busy ? 'Playing…' : 'Play this card'}</button>
              <button type="button" className="cg-link" onClick={onLeave}>Forfeit match</button>
            </div>
          </div>}
      </div>
    </section>

    <aside className="cg-col cg-col-opp" aria-label={`${opponent.handle}'s hand`}>
      <Score who="opp" name={`${opponent.flag} ${opponent.handle}`} sub={`${opponent.city} · demo: computer`} points={v.oppScore} />
      <p className="cg-col-title">THEIR TEAM</p>
      <ul className="cg-grid">{v.oppLineup.map((c) => <li key={c.id}>{c.id in v.oppUsed ? <span className="cg-back is-played" aria-hidden="true" /> : <Back />}</li>)}</ul>
      <p className="cg-col-count">{v.oppLineup.filter((c) => !(c.id in v.oppUsed)).length} cards left</p>
    </aside>
  </div>;
}
