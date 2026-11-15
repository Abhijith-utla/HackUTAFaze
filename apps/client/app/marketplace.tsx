'use client';
// Trade Floor: one page, no tabs. Incoming offers on top (accept / decline in place), live search + rarity chips,
// a listings grid, a side panel to make an offer, a picker to list a card, and a collapsed "Your activity" section.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionEntry, MeResponse } from '@faze/shared';
import { ApiError, art, request } from '../lib/api';
import type { Listing, MarketCard, Offer } from '../lib/marketplace';
import Notifications from './notifications';
import './tradefloor.css';

type Inbox = { incoming: Offer[]; outgoing: Offer[]; listings: Listing[] };
const RARITIES = ['all', 'common', 'rare', 'epic', 'legendary'] as const;
const RANK: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
type Mine = { id: string; serial: number; name: string; rarity: string; artUrl: string };

function Thumb({ item, small }: { item: MarketCard; small?: boolean }) {
  return <span className={`tf-thumb tf-${item.card.rarity}${small ? ' tf-small' : ''}`} title={`${item.card.name} #${item.serial}`}><img src={art(item.card.artUrl)} alt={item.card.name} loading="lazy" /></span>;
}

export default function Marketplace({ onChange, standalone = false }: { onChange?: () => Promise<void>; standalone?: boolean }) {
  const [user, setUser] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [inbox, setInbox] = useState<Inbox>({ incoming: [], outgoing: [], listings: [] });
  const [cards, setCards] = useState<CollectionEntry[]>([]);
  const [query, setQuery] = useState(''), [rarity, setRarity] = useState<string>('all');
  const [page, setPage] = useState(1), [more, setMore] = useState(false), [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<null | { kind: 'offer'; target: Listing } | { kind: 'list' }>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const locked = useRef(false), callback = useRef(onChange);
  callback.current = onChange;

  const loadPrivate = useCallback(async () => {
    const [m, c] = await Promise.all([request<Inbox>('/me/marketplace'), request<{ cards: CollectionEntry[] }>('/me/cards')]);
    setInbox(m); setCards(c.cards);
  }, []);

  const loadListings = useCallback(async (nextPage: number, replace: boolean) => {
    const url = `/marketplace/listings?q=${encodeURIComponent(query)}&page=${nextPage}${rarity !== 'all' ? '&rarity=' + rarity : ''}`;
    const r = await request<{ listings: Listing[] }>(url);
    setListings(prev => replace ? r.listings : [...prev, ...r.listings]);
    setMore(r.listings.length >= 25); setPage(nextPage);
  }, [query, rarity]);

  // Live search: debounce typing, reload on chip change.
  useEffect(() => {
    let active = true; setLoading(true);
    const t = setTimeout(() => { loadListings(1, true).then(() => active && setError('')).catch(e => active && setError(e.message)).finally(() => active && setLoading(false)); }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [loadListings]);
  useEffect(() => { request<MeResponse>('/me').then(async r => { setUser(r.user.id); await loadPrivate(); }).catch(e => { if (!(e instanceof ApiError) || e.status !== 401) setError(e.message); }); }, [loadPrivate]);
  useEffect(() => { if (!user) return; const timer = setInterval(() => loadPrivate().catch(() => {}), 8000); return () => clearInterval(timer); }, [user, loadPrivate]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (!panel) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [panel]);

  async function changed() { await loadPrivate(); await callback.current?.(); setNotice('Exchange completed. Your collection has been updated.'); }
  async function act(fn: () => Promise<void>, message: string) {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await fn(); await loadListings(1, true); await loadPrivate(); await callback.current?.(); setNotice(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { locked.current = false; setBusy(false); }
  }

  // My tradable copies, rarest first. Locked copies are hidden here: they are already in a trade or listing.
  const mine: Mine[] = useMemo(() => cards.flatMap(c => c.instances.filter(i => !i.locked).map(i => ({ id: i.id, serial: i.serial, name: c.card.name, rarity: c.card.rarity, artUrl: c.card.artUrl }))).sort((a, b) => RANK[a.rarity] - RANK[b.rarity] || a.name.localeCompare(b.name)), [cards]);
  const openIncoming = inbox.incoming.filter(o => o.status === 'open');
  const openOutgoing = inbox.outgoing.filter(o => o.status === 'open');
  const myOpenListings = inbox.listings.filter(l => l.status === 'open');
  const activityCount = openOutgoing.length + myOpenListings.length;

  function picker(onPick: (m: Mine) => void, isOn: (m: Mine) => boolean) {
    if (!mine.length) return <p className="tf-empty">No free cards to use. Open a pack to get some.</p>;
    return <div className="tf-picker">{mine.map(m => <div role="button" tabIndex={0} key={m.id} className={`tf-pick tf-${m.rarity}${isOn(m) ? ' on' : ''}`} onClick={() => !busy && onPick(m)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) onPick(m); } }} aria-pressed={isOn(m)} aria-disabled={busy}>
      <img src={art(m.artUrl)} alt="" loading="lazy" /><span>{m.name}</span><small>{m.rarity} · #{m.serial}</small>{isOn(m) && <i aria-hidden="true">✓</i>}
    </div>)}</div>;
  }

  return <section className="tf">
    {standalone && <div className="market-heading"><div><p className="eyebrow">COLLECTOR EXCHANGE / CARDS FOR CARDS</p><h2>Trade floor</h2></div>{user && <Notifications userId={user} onChange={changed} />}</div>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {notice && <p className="alert" role="status">{notice}</p>}

    {user && openIncoming.length > 0 && <section className="tf-offers" aria-label="Offers waiting for you">
      <h3>{openIncoming.length} {openIncoming.length === 1 ? 'offer' : 'offers'} waiting for you</h3>
      {openIncoming.map(o => <article key={o.id} className="tf-offer">
        <div className="tf-offer-who"><b>{o.bidder.displayName}</b><span>offers</span></div>
        <div className="tf-offer-cards">{o.offered.map(i => <Thumb key={i.id} item={i} small />)}</div>
        <span className="tf-swap" aria-hidden="true">⇄</span>
        <div className="tf-offer-cards"><Thumb item={o.listed} small /><span className="tf-offer-for">{o.listed.card.name}</span></div>
        <div className="tf-offer-actions">
          <button className="primary" disabled={busy} onClick={() => act(() => request(`/marketplace/offers/${o.id}/accept`, {}), 'Trade complete. The new cards are in your collection.')}>Accept</button>
          <button disabled={busy} onClick={() => act(() => request(`/marketplace/offers/${o.id}/decline`, {}), 'Offer declined. Your card is available again.')}>Decline</button>
        </div>
      </article>)}
    </section>}

    <div className="tf-bar">
      <label className="tf-search"><span className="sr-only">Search cards or FaZe members</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a card or FaZe member" maxLength={100} /></label>
      <div className="tf-chips" role="group" aria-label="Rarity">{RARITIES.map(r => <button key={r} className={r === rarity ? 'on' : ''} aria-pressed={r === rarity} onClick={() => setRarity(r)}>{r === 'all' ? 'All' : r}</button>)}</div>
      {user && <button className="primary tf-list" onClick={() => { setSelected([]); setPanel({ kind: 'list' }); }}>+ List a card</button>}
    </div>

    {loading && !listings.length ? <p className="tf-empty" role="status">Loading listings…</p> : <div className="tf-grid">
      {listings.map(l => {
        const own = l.owner_id === user;
        const open = own ? myOpenListings.find(x => x.id === l.id) : null;
        return <article className={`tf-card tf-${l.instance.card.rarity}`} key={l.id}>
          <div className="tf-art"><img src={art(l.instance.card.artUrl)} alt={l.instance.card.name} loading="lazy" /></div>
          <div className="tf-meta"><strong>{l.instance.card.name}</strong><span>{l.instance.card.rarity} · #{l.instance.serial}</span><small>{own ? 'Your listing' : `by ${l.owner.displayName}`}</small></div>
          {own ? <button disabled={busy || !open} onClick={() => act(() => request(`/marketplace/listings/${l.id}/cancel`, {}), 'Listing cancelled. Your card is free again.')}>Cancel listing</button>
            : user ? <button className="primary" disabled={busy} onClick={() => { setSelected([]); setPanel({ kind: 'offer', target: l }); }}>Offer a swap</button>
            : <a className="tf-signin" href="/">Sign in to trade</a>}
        </article>;
      })}
    </div>}
    {!loading && !listings.length && <p className="tf-empty">{query || rarity !== 'all' ? 'No listings match. Try another search.' : 'Nothing listed yet. Be the first to list a card.'}</p>}
    {more && <button className="tf-more" disabled={loading} onClick={() => loadListings(page + 1, false).catch(e => setError(e.message))}>Load more</button>}

    {user && <details className="tf-activity">
      <summary>Your activity{activityCount ? ` (${activityCount})` : ''}</summary>
      {!openOutgoing.length && !myOpenListings.length && <p className="tf-empty">Nothing in progress.</p>}
      {openOutgoing.map(o => <div className="tf-row" key={o.id}>
        <span className="tf-row-label">Offer sent</span><div className="tf-offer-cards">{o.offered.map(i => <Thumb key={i.id} item={i} small />)}</div><span className="tf-swap" aria-hidden="true">⇄</span><Thumb item={o.listed} small /><span className="tf-offer-for">{o.listed.card.name}</span>
        <button disabled={busy} onClick={() => act(() => request(`/marketplace/offers/${o.id}/withdraw`, {}), 'Offer withdrawn. Your cards are free again.')}>Withdraw</button>
      </div>)}
      {myOpenListings.map(l => <div className="tf-row" key={l.id}>
        <span className="tf-row-label">Listed</span><Thumb item={l.instance} small /><span className="tf-offer-for">{l.instance.card.name} #{l.instance.serial}</span>
        <button disabled={busy} onClick={() => act(() => request(`/marketplace/listings/${l.id}/cancel`, {}), 'Listing cancelled. Your card is free again.')}>Cancel</button>
      </div>)}
    </details>}

    {panel && <div className="tf-scrim" onClick={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className="tf-panel" role="dialog" aria-modal="true" aria-label={panel.kind === 'offer' ? 'Make an offer' : 'List a card'}>
        <header><h3>{panel.kind === 'offer' ? 'Offer a swap' : 'List a card'}</h3><button onClick={() => setPanel(null)} aria-label="Close">✕</button></header>
        {panel.kind === 'offer' ? <>
          <div className="tf-target"><Thumb item={panel.target.instance} /><div><small>You want</small><strong>{panel.target.instance.card.name}</strong><span>{panel.target.instance.card.rarity} · #{panel.target.instance.serial} · from {panel.target.owner.displayName}</span></div></div>
          <p className="tf-hint">Pick the cards you will give. They stay reserved until the offer closes.</p>
          {picker(m => setSelected(s => s.includes(m.id) ? s.filter(x => x !== m.id) : s.length < 20 ? [...s, m.id] : s), m => selected.includes(m.id))}
          <footer><button className="primary" disabled={busy || !selected.length} onClick={() => { const t = panel.target; act(async () => { await request(`/marketplace/listings/${t.id}/offers`, { instanceIds: selected }); setPanel(null); setSelected([]); }, 'Offer sent. They have been notified.'); }}>Send offer{selected.length ? ` · ${selected.length} ${selected.length === 1 ? 'card' : 'cards'}` : ''}</button></footer>
        </> : <>
          <p className="tf-hint">Tap a card to list it. It is reserved until you cancel or someone completes a swap.</p>
          {picker(m => act(async () => { await request('/marketplace/listings', { instanceId: m.id }); setPanel(null); }, `${m.name} is listed.`), () => false)}
        </>}
      </aside>
    </div>}
  </section>;
}
