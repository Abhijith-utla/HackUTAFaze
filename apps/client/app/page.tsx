'use client';
import type { Card, CardInstance, CollectionEntry, MeResponse, Pack, Trade, LeaderboardResponse, Bundle, Purchase } from '@faze/shared';
import { useEffect, useState } from 'react';
import { API, PAYMENTS, ApiError, art, request } from '../lib/api';
import { buyCoins, confirmPayment } from '../lib/phantom';
import Trades from './trades';
import PackOpening from './pack-opening';
function CardView({ card, extra, onClick }: {
    card: Card;
    extra?: React.ReactNode;
    onClick?: () => void;
}) { return <button className={`card ${card.rarity}`} onClick={onClick}><div className="art"><img src={art(card.artUrl)} alt={card.name}/><span className="rarity">{card.rarity}</span></div><small>{card.fazeMember}</small><h3>{card.name}</h3><div className="card-meta"><span>POWER {card.basePower}</span>{card.demo && <span>DEMO</span>}</div>{extra}</button>; }
export default function Home() {
    const [tab, setTab] = useState('Store'), [me, setMe] = useState<MeResponse | null>(null), [packs, setPacks] = useState<Pack[]>([]), [cards, setCards] = useState<CollectionEntry[]>([]), [board, setBoard] = useState<LeaderboardResponse | null>(null), [bundles, setBundles] = useState<Bundle[]>([]), [purchases, setPurchases] = useState<Purchase[]>([]), [pull, setPull] = useState<CardInstance[]>([]), [detail, setDetail] = useState<{
        card: Card;
        stats: {
            hype: number;
        };
    } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false), [signup, setSignup] = useState(false), [rarity, setRarity] = useState('all');
    const [opening, setOpening] = useState(false);
    const [openKeys, setOpenKeys] = useState<Record<string, string>>({});
    async function refresh() { const user = await request<MeResponse>('/me'); setMe(user); const collection = await request<{
        cards: CollectionEntry[];
    }>('/me/cards'); setCards(collection.cards); }
    async function run(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
    finally {
        setBusy(false);
    } }
    useEffect(() => { if (!detail) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [detail]);
    useEffect(() => { request<MeResponse>('/me').then(setMe).catch(e => { if (!(e instanceof ApiError) || e.status !== 401)
        setError(String(e)); }).finally(() => setReady(true)); request<{
        packs: Pack[];
    }>('/packs').then(r => setPacks(r.packs)).catch(e => setError(String(e))); }, []);
    useEffect(() => { if (!me)
        return; run(async () => { if (tab === 'Collection')
        await refresh(); if (tab === 'Leaderboard')
        setBoard(await request<LeaderboardResponse>('/leaderboard')); if (tab === 'Coins') {
        const b = await request<{
            bundles: Bundle[];
        }>('/payments/bundles', undefined, PAYMENTS);
        setBundles(b.bundles);
        setPurchases((await request<{
            purchases: Purchase[];
        }>('/me/purchases', undefined, PAYMENTS)).purchases);
    } }); }, [tab, me?.user.id]);
    async function authenticate(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const data = new FormData(e.currentTarget); await run(async () => { await request(signup ? '/auth/signup' : '/auth/login', { email: data.get('email'), password: data.get('password'), ...(signup ? { displayName: data.get('displayName') } : {}) }); await refresh(); }); }
    async function open(pack: Pack) { await run(async () => { const key = openKeys[pack.id] ?? crypto.randomUUID(); setOpenKeys(v => ({ ...v, [pack.id]: key })); const result = await request<{
        cards: CardInstance[];
        balance: number;
    }>(`/packs/${pack.id}/open`, { idempotencyKey: key }); setPull(result.cards); setOpening(true); setMe(v => v ? { ...v, balance: result.balance } : v); setOpenKeys(v => { const copy = { ...v }; delete copy[pack.id]; return copy; }); }); }
    // Not Object.groupBy: it is missing on iOS Safari < 17.4.
    const groups: Record<string, CollectionEntry[]> = {};
    for (const c of cards) if (rarity === 'all' || c.card.rarity === rarity) (groups[c.card.setId] ??= []).push(c);
    return <>{opening && pull.length > 0 && <PackOpening cards={pull} onClose={() => setOpening(false)} />}<header><a className="brand" href="/">F<span>Λ</span>ZE <b>VAULT</b></a><div className="account"><span className="demo">DEMO EXPERIENCE</span>{me && <><strong>{me.balance.toLocaleString()} <small>COINS</small></strong><button onClick={() => run(async () => { await request('/auth/logout', {}); setMe(null); setCards([]); setPull([]); })}>Log out</button></>}</div></header><main><section className="hero"><p className="eyebrow">THE COLLECTION STARTS HERE / 001</p><h1>COLLECT MOMENTS.<br /><span>BUILD YOUR LEGACY.</span></h1><p>Open packs. Find your icons. Trade your way to the top.</p></section><nav aria-label="Main navigation">{['Store', 'Collection', 'Trades', 'Leaderboard', 'Coins'].map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setDetail(null); setPull([]); }}>{t === 'Coins' ? '＋ Buy coins' : t}</button>)}</nav>{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}{busy && <p role="status" className="loading">Working…</p>}{!ready ? <p>Loading your vault…</p> : !me ? <section className="auth panel"><p className="eyebrow">YOUR NEXT GREAT PULL AWAITS</p><h2>{signup ? 'Join the collection' : 'Welcome to the vault'}</h2><p>Sign up for 500 demo coins. Coins have no cash value.</p><form onSubmit={authenticate}>{signup && <label>Display name<input name="displayName" required minLength={2} maxLength={24}/></label>}<label>Email<input type="email" name="email" required autoComplete="email"/></label><label>Password<input type="password" name="password" required minLength={8} autoComplete={signup ? 'new-password' : 'current-password'}/></label><button className="primary" disabled={busy}>{signup ? 'Create account' : 'Enter vault'}</button></form><button onClick={() => setSignup(!signup)}>{signup ? 'Already collecting? Log in' : 'New here? Create an account'}</button></section> : <>
 <div className="section-title"><div><p className="eyebrow">WELCOME, {me.user.displayName}</p><h2>{tab === 'Coins' ? 'Fuel your next pull' : tab}</h2></div><button disabled={busy} onClick={() => run(async () => { await refresh(); setPacks((await request<{
            packs: Pack[];
        }>('/packs')).packs); if (tab === 'Leaderboard')
            setBoard(await request<LeaderboardResponse>('/leaderboard')); setNotice('Updated from the server.'); })}>↻ Refresh</button></div>
 {tab === 'Store' && <>{pull.length > 0 && <section className="reveal"><h2>Your pull is in.</h2><p>Server-verified results · added to your collection</p><div className="grid">{pull.map((i, n) => <div className="revealed" style={{ animationDelay: `${n * .15}s` }} key={i.id}><CardView card={i.card} extra={<p>Serial #{i.serial}</p>}/></div>)}</div></section>}<div className="grid packs">{packs.map((p, n) => <article className="panel pack" key={p.id}><div className="pack-art"><span>FΛZE</span><b>{String(n + 1).padStart(2, '0')}</b><small>{p.cardsPerPack} CARDS / PACK</small></div><h3>{p.name}</h3><details><summary>Published pull odds · v{p.oddsVersion}</summary><dl>{Object.entries(p.odds).map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v}%</dd></div>)}</dl></details><button className="primary" disabled={busy || me.balance < p.priceCoins} onClick={() => open(p)}>{p.priceCoins} coins · {openKeys[p.id] ? 'Retry opening' : 'Open pack'}</button></article>)}</div>{packs.length === 0 && <p className="empty">No live packs yet. Refresh after a set is published.</p>}</>}
 {tab === 'Collection' && <><label className="filter">Rarity<select value={rarity} onChange={e => setRarity(e.target.value)}>{['all', 'common', 'rare', 'epic', 'legendary'].map(r => <option key={r}>{r}</option>)}</select></label>{Object.entries(groups).map(([id, entries]) => <section key={id}><h3>SET / {id.slice(0, 8)}</h3><div className="grid">{entries?.map(c => <CardView key={c.card.id} card={c.card} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))} extra={<p>{c.count} owned · {c.instances.map(i => `#${i.serial}${i.locked ? ' (locked)' : ''}`).join(', ')}</p>}/>)}</div></section>)}{cards.length === 0 && <p className="empty">Your collection starts with your first pack.</p>}</>}
 {tab === 'Trades' && <Trades busy={busy} run={run} notify={setNotice}/>}
 {tab === 'Leaderboard' && board && <div className="leader-layout"><section className="panel"><h3>TOP COLLECTORS</h3>{board.collectors.map((c, n) => <div className="rank" key={c.user.id}><b>{String(n + 1).padStart(2, '0')}</b><span>{c.user.displayName}</span><strong>{c.score} pts</strong></div>)}{!board.collectors.length && <p>No ranked collectors yet.</p>}</section><section><h3>TRENDING / SIMULATED ENGAGEMENT</h3><div className="grid">{board.trending.map(c => <CardView key={c.card.id} card={c.card} extra={<p className="hype">HYPE {c.hype}/100 · SIMULATED</p>} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))}/>)}</div></section></div>}
 {tab === 'Coins' && <><p className="alert">TEST PAYMENT · SOLANA DEVNET · No real value. Use Phantom’s Solana Devnet setting. You need devnet SOL for the payment and network fee. <a href="https://phantom.app" target="_blank" rel="noreferrer">Get Phantom</a></p><div className="grid">{bundles.map(b => <article className="panel" key={b.id}><p className="eyebrow">DEMO COIN BUNDLE</p><h2>{b.coins.toLocaleString()}</h2><p>{b.lamports / 1e9} devnet SOL</p><button disabled={busy} className="primary" onClick={() => run(async () => { await buyCoins(b.id, setNotice); await refresh(); setNotice('Payment verified by the server. Coins added.'); setPurchases((await request<{
            purchases: Purchase[];
        }>('/me/purchases', undefined, PAYMENTS)).purchases); })}>Connect Phantom & pay</button></article>)}</div><h3>PURCHASES</h3>{purchases.map(p => <article className="purchase panel" key={p.id}><div><strong>{p.coins} coins</strong><p>{new Date(p.createdAt).toLocaleString()} · {p.cluster} · TEST</p><small>{p.status}</small></div>{p.status === 'pending' && <button disabled={busy} onClick={() => run(async () => { await confirmPayment(p.id); await refresh(); setPurchases((await request<{
            purchases: Purchase[];
        }>('/me/purchases', undefined, PAYMENTS)).purchases); setNotice('Payment confirmed.'); })}>Check payment</button>}</article>)}</>}
 </>}{detail && <div className="modal" role="dialog" aria-modal="true" aria-label="Card details" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><section className="panel"><button autoFocus onClick={() => setDetail(null)}>Close details ✕</button><CardView card={detail.card}/><p>Hype: {detail.stats.hype}/100 · simulated engagement</p><p>Set: {detail.card.setId}</p><p>Supply: {detail.card.maxSupply ?? 'Unlimited'}</p></section></div>}</main><footer>FΛZE VAULT / DEMO COLLECTIBLES <span>Coins cannot be redeemed for cash.</span></footer></>;
}
