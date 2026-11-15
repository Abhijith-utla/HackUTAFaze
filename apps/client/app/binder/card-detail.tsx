'use client';
import { useEffect, useRef, useState } from 'react';
import { art, thumb } from '../../lib/api';
import { playCardVoice, stopCardVoice } from '../../lib/voice';
import type { BinderCardInfo, BinderInstance } from './types';

/** One card in the grid. A card you don't own is a blurred, desaturated teaser (colour and shape visible, details hidden). */
export function CardTile({ card, badge, missing, onClick, children }: { card: BinderCardInfo; badge?: string; missing?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  return <button type="button" className={`bd-card r-${card.rarity}${missing ? ' is-missing' : ''}`} onClick={onClick} disabled={missing}
    aria-label={missing ? `Not collected: ${card.rarity} card` : card.name}>
    <img src={thumb(card.artUrl)} alt="" loading="lazy" decoding="async" />
    {badge && <span className="bd-badge">{badge}</span>}
    <small>{missing ? 'Not collected' : card.rarity}</small><b>{missing ? '???' : card.name}</b>
    {children}
  </button>;
}

/** Card detail: lore, era, edition (your serials), power. Closes with Escape or a click outside. */
export default function CardDetail({ card, instances, onClose }: { card: BinderCardInfo; instances: BinderInstance[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => stopCardVoice(), []);
  const toggleVoice = () => { if (speaking) { stopCardVoice(); return; } setSpeaking(true); playCardVoice(card.id, () => setSpeaking(false)).catch(() => setSpeaking(false)); };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  const locked = instances.filter(i => i.tradableAfter && new Date(i.tradableAfter) > new Date());
  return <div className="bd-overlay" onClick={onClose}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={card.name} className="bd-dialog" onClick={e => e.stopPropagation()}>
      <div className="bd-detail">
        <img src={art(card.artUrl)} alt={card.name} />
        <div className="bd-detail-body">
          <div className="bd-row"><span className="bd-chip">{card.rarity}</span>{card.era && <span className="bd-chip">{card.era.name}</span>}{card.demo && <span className="bd-chip">Demo</span>}</div>
          <h3>{card.name}</h3>
          {card.lore && <p className="bd-lore">{card.lore}</p>}
          <dl className="bd-row">
            <div><dt className="bd-label">Your copies</dt><dd>{instances.map(i => `#${i.serial}`).join(', ')}</dd></div>
            <div><dt className="bd-label">Edition</dt><dd>{card.maxSupply ? `Limited to ${card.maxSupply}` : 'Open edition'}</dd></div>
            <div><dt className="bd-label">Power</dt><dd>{card.basePower}</dd></div>
          </dl>
          {locked.length > 0 && <p className="bd-muted">Tradable again after {new Date(locked[0].tradableAfter!).toLocaleDateString()}.</p>}
          <div className="bd-row">{card.hasVoice && <button type="button" onClick={toggleVoice}>{speaking ? '■ Stop' : '▶ Hear its legacy'}</button>}<button type="button" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>
  </div>;
}
