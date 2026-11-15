'use client';
import type { Card } from '@faze/shared';
import { useEffect, useRef, useState } from 'react';
import { art } from '../lib/api';

/* Shared app-shell pieces: card tile, sidebar, top bar, icons. Styles live in arena.css. */

/** Leaderboard points per owned copy (server rule: common 1, rare 3, epic 10, legendary 25). */
export const RARITY_POINTS: Record<Card['rarity'], number> = { common: 1, rare: 3, epic: 10, legendary: 25 };
export const RARITY_LABEL: Record<Card['rarity'], string> = { common: 'Bronze', rare: 'Silver', epic: 'Epic', legendary: 'Legendary' };
export type Tier = 'Bronze' | 'Silver' | 'Epic' | 'Legendary' | 'Mythic';
/** Printed tier. The DB has four rarities; the catalog stores the tier score in basePower (Mythic = 100). */
export function tierOf(card: Card): Tier { return card.rarity === 'legendary' && card.basePower >= 100 ? 'Mythic' : RARITY_LABEL[card.rarity] as Tier; }

export function FazeCard({ card, serial, onClick, selected, dim, badge, footer, compact }: {
  card: Card;
  serial?: number;
  onClick?: () => void;
  selected?: boolean;
  dim?: boolean;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  const tier = tierOf(card);
  const body = <>
    <span className="fc-face">
      <img src={art(card.artUrl)} alt={compact ? card.name : ''} loading="lazy" />
      {badge !== undefined && <span className="fc-badge">{badge}</span>}
      {serial !== undefined && <span className="fc-serial">#{serial}</span>}
    </span>
    {!compact && <span className="fc-caption"><span className={`tier-chip t-${tier.toLowerCase()}`}>{tier}</span><b>{card.name}</b><small>{card.momentOn?.slice(0, 4)}{card.maxSupply ? ` · /${card.maxSupply.toLocaleString()}` : ''}</small></span>}
    {footer}
  </>;
  const cls = `fc fc-${card.rarity} fc-t-${tier.toLowerCase()}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${compact ? ' fc-compact' : ''}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-label={`${card.name}, ${tier}${card.momentOn ? `, ${card.momentOn.slice(0, 4)}` : ''}`} aria-pressed={selected}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export type View = 'Home' | 'Binder' | 'Packs' | 'Drops' | 'Market' | 'Clips' | 'Leaderboard' | 'Wallet';

const ICONS: Record<string, React.ReactNode> = {
  Home: <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />,
  Binder: <path d="M6 3h12v18H6zM6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2M10 8h5M10 12h5" />,
  Packs: <path d="M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2" />,
  Drops: <path d="M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z" />,
  Market: <path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6" />,
  Clips: <path d="M3 6h13v12H3zM16 10l5-3v10l-5-3" />,
  Leaderboard: <path d="M4 5h16v14H4zM8 15V11M12 15V8M16 15v-3" />,
  Play: <path d="M7 4l12 8-12 8z" />,
  Wallet: <path d="M3 7h16v12H3zM3 7l12-3v3M15 13h4" />,
  Bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  Search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />,
  Chevron: <path d="M6 9l6 6 6-6" />,
  Close: <path d="M6 6l12 12M18 6L6 18" />,
  Coin: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h5M12 6v2M12 16v2" />,
  Cards: <path d="M8 3h11v15H8zM5 6v15h11" />,
  Plus: <path d="M12 5v14M5 12h14" />,
  Trophy: <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8" />,
  Lock: <path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" />,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

export function Logo() {
  return <span className="logo"><span className="logo-ring" aria-hidden="true"><b>F</b></span>faze<em>vault</em></span>;
}

export function Sidebar({ view, go, balance, cardCount, badge, open, onClose }: {
  view: View;
  go: (v: View) => void;
  balance: number;
  cardCount: number;
  badge?: number;
  open: boolean;
  onClose: () => void;
}) {
  const items: View[] = ['Home', 'Binder', 'Packs', 'Drops', 'Market', 'Clips', 'Leaderboard'];
  return <nav className={`side${open ? ' is-open' : ''}`} aria-label="Main">
    <div className="side-top"><a href="#Home" className="side-logo" onClick={e => { e.preventDefault(); go('Home'); }}><Logo /></a><span className="side-switch" aria-hidden="true">KAM</span><button className="side-close" onClick={onClose} aria-label="Close menu"><Icon name="Close" /></button></div>
    <ul className="side-nav">{items.map(i => <li key={i}><a href={`#${i}`} aria-current={view === i ? 'page' : undefined} onClick={e => { e.preventDefault(); go(i); }}><Icon name={i} /><span>{i}</span>{i === 'Home' && badge ? <b className="dot">{badge}</b> : null}</a></li>)}</ul>
    <div className="side-wallet">
      <div className="wallet-row"><span><Icon name="Coin" size={16} /><b>{balance.toLocaleString()}</b><small>coins</small></span><span><Icon name="Cards" size={16} /><b>{cardCount}</b><small>moments</small></span></div>
      <button className="pill pill-violet wallet-cta" onClick={() => go('Wallet')}><Icon name="Plus" size={14} />Add coins</button>
      <small className="wallet-note">Demo coins · no cash value</small>
    </div>
  </nav>;
}

export function UserMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="user-menu" ref={ref}>
    <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open}><span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><span className="user-name">{name}</span><Icon name="Chevron" size={16} /></button>
    {open && <div className="user-pop" role="menu"><p>Signed in as <b>{name}</b></p><button role="menuitem" className="pill pill-dark" onClick={onLogout}>Log out</button></div>}
  </div>;
}
