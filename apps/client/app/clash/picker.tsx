'use client';
// Team picker: a popup with every card you own (small, minimal). Tap five and it closes by itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { thumb } from '../../lib/api';
import type { PlayCard } from './view';

export const TEAM_SIZE = 5;

export default function TeamPicker({ cards, initial, onDone, onClose }: { cards: PlayCard[]; initial: string[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const panel = useRef<HTMLDivElement>(null);
  const distinct = useMemo(() => cards.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i), [cards]); // a moment can only be on the team once
  const full = picked.length === TEAM_SIZE;

  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length < TEAM_SIZE ? [...p, id] : p);

  // Auto-close a beat after the fifth card, so the last pick is seen.
  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => onDone(picked), 420);
    return () => clearTimeout(t);
  }, [full, picked, onDone]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);

  // Rendered on <body>: an ancestor of the page content has an animation/filter that would otherwise trap position:fixed inside the page.
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="cg-overlay" onClick={onClose}>
    <div ref={panel} tabIndex={-1} className="cg-picker" role="dialog" aria-modal="true" aria-label="Choose your team" onClick={(e) => e.stopPropagation()}>
      <header>
        <div><p className="cg-eyebrow">YOUR COLLECTION</p><h3>Pick your team of five</h3></div>
        <div className="cg-picker-meta">
          <span className="cg-dots" aria-label={`${picked.length} of ${TEAM_SIZE} picked`}>{Array.from({ length: TEAM_SIZE }, (_, i) => <i key={i} className={i < picked.length ? 'on' : ''} />)}</span>
          <strong>{picked.length} / {TEAM_SIZE}</strong>
          {picked.length > 0 && !full && <button type="button" className="cg-link" onClick={() => setPicked([])}>Clear</button>}
          <button type="button" className="cg-x" onClick={onClose} aria-label="Close">×</button>
        </div>
      </header>
      <div className="cg-picker-grid">
        {distinct.map((c) => {
          const n = picked.indexOf(c.id);
          return <button key={c.id} type="button" className={`cg-pick${n >= 0 ? ' is-on' : ''}`} aria-pressed={n >= 0} disabled={full && n < 0} onClick={() => toggle(c.id)} title={`${c.name} · ${c.moment_tags.join(', ')}`}>
            <img src={thumb(c.art_url, 300)} alt="" loading="lazy" decoding="async" />
            {n >= 0 && <b className="cg-pick-n">{n + 1}</b>}
            <span>{c.name}</span>
          </button>;
        })}
      </div>
      <p className="cg-picker-hint">{full ? 'Team locked in…' : `Pick ${TEAM_SIZE - picked.length} more. Each card can be played once in a match, so choose a mix.`}</p>
    </div>
  </div>, document.body);
}
