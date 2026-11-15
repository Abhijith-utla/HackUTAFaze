'use client';
// The whole team laid out on the table, before you start. Change it, or start the battle.
import { thumb } from '../../lib/api';
import type { PlayCard } from './view';

export default function Lineup({ team, onChange, onStart, busy }: { team: PlayCard[]; onChange: () => void; onStart: () => void; busy: boolean }) {
  return <section className="cg-table cg-lineup" aria-label="Your lineup">
    <div className="cg-top">
      <div className="cg-prompt">
        <p className="cg-eyebrow">YOUR LINEUP</p>
        <h3>Ready to battle?</h3>
        <p>Five rounds. Each round you play ONE card for the prompt: the card whose tags match it best wins the point. Every card can be played once.</p>
      </div>
    </div>
    <ul className="cg-lineup-row">{team.map((c, i) => <li key={c.id} style={{ ['--i' as string]: i } as React.CSSProperties}>
      <span className="cg-face"><img src={thumb(c.art_url, 360)} alt={c.name} /></span>
      <span className="cg-hname">{c.name}</span>
      <span className="cg-htags">{c.moment_tags.map((t) => <i key={t}>{t}</i>)}</span>
    </li>)}</ul>
    <div className="cg-actions cg-lineup-actions">
      <button type="button" className="cg-primary" disabled={busy} onClick={onStart} autoFocus>{busy ? 'Starting…' : 'Start battle'}</button>
      <button type="button" className="cg-link" disabled={busy} onClick={onChange}>Change team</button>
    </div>
  </section>;
}
