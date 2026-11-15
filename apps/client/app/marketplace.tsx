'use client';
import { useEffect, useRef, useState } from 'react';
import type { CollectionEntry, MeResponse } from '@faze/shared';
import { ApiError, art, request } from '../lib/api';
import type { Listing, MarketCard, Offer } from '../lib/marketplace';
import Notifications from './notifications';
import DirectTrades from './trades';
type Inbox = {
    incoming: Offer[];
    outgoing: Offer[];
    listings: Listing[];
};
function CardTile({ item }: {
    item: MarketCard;
}) { return <div className={`market-card ${item.card.rarity}`}><img src={art(item.card.artUrl)} alt={item.card.name}/><div><small>{item.card.rarity} · #{item.serial}</small><h3>{item.card.name}</h3><span>{item.card.fazeMember}</span></div></div>; }
export default function Marketplace({ onChange, standalone = false }: {
    onChange?: () => Promise<void>;
    standalone?: boolean;
}) {
    const [user, setUser] = useState<string | null>(null), [listings, setListings] = useState<Listing[]>([]), [inbox, setInbox] = useState<Inbox>({ incoming: [], outgoing: [], listings: [] }), [cards, setCards] = useState<CollectionEntry[]>([]), [tab, setTab] = useState('Browse'), [query, setQuery] = useState(''), [rarity, setRarity] = useState(''), [page, setPage] = useState(1), [target, setTarget] = useState<Listing | null>(null), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true);
    const locked = useRef(false), callback = useRef(onChange);
    callback.current = onChange;
    async function loadPrivate() { const [m, c] = await Promise.all([request<Inbox>('/me/marketplace'), request<{
            cards: CollectionEntry[];
        }>('/me/cards')]); setInbox(m); setCards(c.cards); }
    async function refresh() { const url = `/marketplace/listings?q=${encodeURIComponent(query)}&page=${page}${rarity ? '&rarity=' + rarity : ''}`; setListings((await request<{
        listings: Listing[];
    }>(url)).listings); if (user)
        await loadPrivate(); }
    useEffect(() => { let active = true; setLoading(true); request<{
        listings: Listing[];
    }>(`/marketplace/listings?q=${encodeURIComponent(query)}&page=${page}${rarity ? '&rarity=' + rarity : ''}`).then(r => { if (active) {
        setListings(r.listings);
        setError('');
    } }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [query, rarity, page]);
    useEffect(() => { request<MeResponse>('/me').then(async (r) => { setUser(r.user.id); await loadPrivate(); }).catch(e => { if (!(e instanceof ApiError) || e.status !== 401)
        setError(e.message); }); }, []);
    useEffect(() => { if (!user)
        return; const timer = setInterval(() => loadPrivate().catch(() => { }), 8000); return () => clearInterval(timer); }, [user]);
    async function changed() { await loadPrivate(); await callback.current?.(); setNotice('Exchange completed. Your collection has been updated.'); }
    async function act(fn: () => Promise<void>, message: string) { if (locked.current)
        return; locked.current = true; setBusy(true); setError(''); try {
        await fn();
        await refresh();
        await callback.current?.();
        setNotice(message);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Request failed');
    }
    finally {
        locked.current = false;
        setBusy(false);
    } }
    function offers(items: Offer[], incoming: boolean) { return items.length ? items.map(o => <article className="panel market-offer" key={o.id}><div className="market-offer-header"><b>{incoming ? o.bidder.displayName : 'Your offer'}</b><span className="market-status">{o.status}</span></div><div className="market-exchange"><section><p>{incoming ? 'They offer' : 'You offer'}</p><div className="market-mini-grid">{o.offered.map(i => <CardTile key={i.id} item={i}/>)}</div></section><span aria-hidden="true">⇄</span><section><p>{incoming ? 'For your card' : 'For this card'}</p><CardTile item={o.listed}/></section></div>{o.status === 'open' && <div className="actions">{(incoming ? ['accept', 'decline'] : ['withdraw']).map(action => <button className={action === 'accept' ? 'primary' : ''} disabled={busy} key={action} onClick={() => act(() => request(`/marketplace/offers/${o.id}/${action}`, {}), action === 'accept' ? 'Trade complete! New cards are now in your collection.' : `Offer ${action === 'withdraw' ? 'withdrawn' : 'declined'}. Reserved cards released.`)}>{action}</button>)}</div>}</article>) : <p className="empty">No {incoming ? 'received' : 'sent'} offers yet.</p>; }
    return <section className="marketplace"><div className="market-heading"><div><p className="eyebrow">COLLECTOR EXCHANGE / CARDS FOR CARDS</p><h2>Trade floor</h2><p>List a card. Find your next favorite. Make an exchange.</p></div>{standalone && user && <Notifications userId={user} onChange={changed}/>}</div>{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}<div className="market-tabs" role="group" aria-label="Marketplace views">{['Browse', 'My listings', 'Received offers', 'Sent offers', 'Direct trades'].map(t => <button key={t} className={t === tab ? 'selected' : ''} onClick={() => { setTab(t); if (user)
        loadPrivate().catch(e => setError(e.message)); }}>{t}{t === 'Received offers' && ` (${inbox.incoming.filter(o => o.status === 'open').length})`}</button>)}<button disabled={busy} onClick={() => act(refresh, 'Marketplace refreshed.')}>Refresh</button></div>
 {tab === 'Browse' && <><form className="market-search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(String(new FormData(e.currentTarget).get('query') ?? '')); }}><label>Find a card<input name="query" placeholder="Card or FaZe member" maxLength={100}/></label><label>Rarity<select value={rarity} onChange={e => { setPage(1); setRarity(e.target.value); }}><option value="">All rarities</option>{['common', 'rare', 'epic', 'legendary'].map(r => <option key={r}>{r}</option>)}</select></label><button>Search</button></form>{loading ? <p role="status">Loading public listings…</p> : <div className="market-grid">{listings.map(l => <article className="panel market-listing" key={l.id}><CardTile item={l.instance}/><p>Listed by {l.owner.displayName}</p>{l.owner_id === user ? <span>Your listing</span> : user ? <button className="primary" disabled={busy} onClick={() => { setTarget(l); setSelected([]); }}>Offer an exchange</button> : <a href="/">Sign in to make an offer</a>}</article>)}</div>}{!loading && !listings.length && <p className="empty">No cards listed here yet. Be the first to list yours.</p>}<div className="actions"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button disabled={listings.length < 25} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
 {tab !== 'Browse' && !user && <p className="alert"><a href="/">Sign in</a> to manage your listings and offers.</p>}
 {user && tab === 'My listings' && <><form className="panel" onSubmit={e => { e.preventDefault(); const id = String(new FormData(e.currentTarget).get('card')); act(() => request('/marketplace/listings', { instanceId: id }), 'Card listed publicly. It is reserved until you cancel or complete an exchange.'); }}><h3>Put a card up for trade</h3><label>Choose an available copy<select name="card" required defaultValue=""><option value="" disabled>Select a card</option>{cards.flatMap(c => c.instances.filter(i => !i.locked).map(i => <option key={i.id} value={i.id}>{c.card.name} #{i.serial} · {c.card.rarity}</option>))}</select></label><button className="primary" disabled={busy}>List card</button></form><div className="market-grid">{inbox.listings.map(l => <article className="panel" key={l.id}><CardTile item={l.instance}/><p className="market-status">{l.status}</p>{l.status === 'open' && <button disabled={busy} onClick={() => act(() => request(`/marketplace/listings/${l.id}/cancel`, {}), 'Listing cancelled. Competing offers closed and all cards released.')}>Cancel listing</button>}</article>)}</div></>}
 {user && tab === 'Direct trades' && <DirectTrades busy={busy} run={fn => act(fn, 'Direct trades refreshed.')} notify={setNotice}/>}
 {user && tab === 'Received offers' && offers(inbox.incoming, true)}{user && tab === 'Sent offers' && offers(inbox.outgoing, false)}
 {target && <section className="panel market-compose" aria-label="Compose exchange offer"><div className="market-offer-header"><h3>Your exchange offer</h3><button onClick={() => setTarget(null)}>Close</button></div><p>Choose cards to offer for <b>{target.instance.card.name} #{target.instance.serial}</b>. Selected cards will be reserved until this offer closes.</p><div className="picker">{cards.flatMap(c => c.instances.map(i => <label key={i.id}><input type="checkbox" disabled={i.locked || busy || (!selected.includes(i.id) && selected.length >= 20)} checked={selected.includes(i.id)} onChange={() => setSelected(s => s.includes(i.id) ? s.filter(x => x !== i.id) : [...s, i.id])}/><span>{c.card.name} #{i.serial} · {c.card.rarity}{i.locked ? ' · Reserved' : ''}</span></label>))}{!cards.length && <p>Open a pack first to get cards to offer.</p>}</div><button className="primary" disabled={busy || !selected.length} onClick={() => act(async () => { await request(`/marketplace/listings/${target.id}/offers`, { instanceIds: selected }); setTarget(null); setSelected([]); }, 'Exchange offer sent. The listing owner has been notified.')}>Send offer ({selected.length} cards)</button></section>}
 </section>;
}
