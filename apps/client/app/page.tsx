'use client';
import Brand from './brand';
import type { Card, CardInstance, CollectionEntry, MeResponse, Pack, Trade, LeaderboardResponse } from '@faze/shared';
import { useEffect, useState } from 'react';
import { API, PAYMENTS, ApiError, art, request } from '../lib/api';
import { buyPack, confirmPackPurchase, clearPackCheckout, type PackPurchase } from '../lib/phantom';
import Marketplace from './marketplace';
import Notifications from './notifications';
import PackOpening from './pack-opening';
import Contribute from './contribute';
function CardView({ card, extra, onClick }: {
    card: Card;
    extra?: React.ReactNode;
    onClick?: () => void;
}) { return <button className={`card ${card.rarity}`} onClick={onClick}><div className="art"><img src={art(card.artUrl)} alt={card.name}/><span className="rarity">{card.rarity}</span></div><small>{card.fazeMember}</small><h3>{card.name}</h3><div className="card-meta"><span>POWER {card.basePower}</span>{card.demo && <span>DEMO</span>}</div>{extra}</button>; }
export default function Home() {
    const [tab, setTab] = useState('Store'), [me, setMe] = useState<MeResponse | null>(null), [packs, setPacks] = useState<Pack[]>([]), [cards, setCards] = useState<CollectionEntry[]>([]), [board, setBoard] = useState<LeaderboardResponse | null>(null), [purchases, setPurchases] = useState<PackPurchase[]>([]), [pull, setPull] = useState<CardInstance[]>([]), [detail, setDetail] = useState<{
        card: Card;
        stats: {
            hype: number;
        };
    } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false), [signup, setSignup] = useState(false), [rarity, setRarity] = useState('all');
    const [opening, setOpening] = useState(false);
    async function loadPurchases() { setPurchases((await request<{purchases:PackPurchase[]}>('/me/pack-purchases')).purchases); }
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
        setBoard(await request<LeaderboardResponse>('/leaderboard')); if (tab === 'Store') await loadPurchases();  }); }, [tab, me?.user.id]);
    async function authenticate(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const data = new FormData(e.currentTarget); await run(async () => { await request(signup ? '/auth/signup' : '/auth/login', { email: data.get('email'), password: data.get('password'), ...(signup ? { displayName: data.get('displayName') } : {}) }); await refresh(); }); }
    async function open(pack:Pack) { if (!me) return; await run(async()=>{try{const result=await buyPack(pack.id,me.user.id,setNotice);if(result.cards){setPull(result.cards);setOpening(true);}await refresh();}finally{await loadPurchases().catch(()=>{});}}); }
    async function recover(purchase:PackPurchase) { if(!me)return; await run(async()=>{const result=await confirmPackPurchase(purchase.purchaseId);clearPackCheckout(me.user.id,purchase.packId,purchase.purchaseId);if(result.cards){setPull(result.cards);setOpening(true);}await refresh();await loadPurchases();setNotice('Payment verified. Your pack is in your collection.');}); }
    // Not Object.groupBy: it is missing on iOS Safari < 17.4.
    const groups: Record<string, CollectionEntry[]> = {};
    for (const c of cards) if (rarity === 'all' || c.card.rarity === rarity) (groups[c.card.setId] ??= []).push(c);
    return <>{opening && pull.length > 0 && <PackOpening cards={pull} onClose={() => setOpening(false)} />}<header><Brand /><div className="account"><span className="demo">DEMO EXPERIENCE</span>{me && <><Notifications userId={me.user.id} onChange={refresh}/><button onClick={() => run(async () => { await request('/auth/logout', {}); setMe(null); setCards([]); setPull([]); })}>Log out</button></>}</div></header><main><section className="hero"><p className="eyebrow">THE COLLECTION STARTS HERE / 001</p><h1>COLLECT MOMENTS.<br /><span>BUILD YOUR LEGACY.</span></h1><p>Open packs. Find your icons. Trade your way to the top.</p></section><nav aria-label="Main navigation">{['Store', 'Collection', 'Trades', 'Leaderboard', 'Contribute'].map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setDetail(null); setPull([]); setError(''); setNotice(''); }}>{t}</button>)}</nav>{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}{busy && <p role="status" className="loading">Working…</p>}{!ready ? <p>Loading your vault…</p> : !me ? <section className="auth panel"><p className="eyebrow">YOUR NEXT GREAT PULL AWAITS</p><h2>{signup ? 'Join the collection' : 'Welcome to the vault'}</h2><p>Connect with collectors. Buy packs with devnet SOL.</p>{tab === 'Contribute' && <p>Sign in or create a fan account to pitch a moment and connect your reward wallet.</p>}<form onSubmit={authenticate}>{signup && <label>Display name<input name="displayName" required minLength={2} maxLength={24}/></label>}<label>Email<input type="email" name="email" required autoComplete="email"/></label><label>Password<input type="password" name="password" required minLength={8} autoComplete={signup ? 'new-password' : 'current-password'}/></label><button className="primary" disabled={busy}>{signup ? 'Create account' : 'Enter vault'}</button></form><button onClick={() => setSignup(!signup)}>{signup ? 'Already collecting? Log in' : 'New here? Create an account'}</button></section> : <>
 <div className="section-title"><div><p className="eyebrow">WELCOME, {me.user.displayName}</p><h2>{tab}</h2></div><button disabled={busy} onClick={() => run(async () => { await refresh(); setPacks((await request<{
            packs: Pack[];
        }>('/packs')).packs); if (tab === 'Leaderboard')
            setBoard(await request<LeaderboardResponse>('/leaderboard')); setNotice('Updated from the server.'); })}>↻ Refresh</button></div>
 {tab === 'Store' && <><p className="alert">SOLANA DEVNET · Pay for packs directly in Phantom. No real-value SOL. Network fees apply in addition to the displayed pack price.</p>{purchases.length>0&&<section className="panel"><h3>Store purchases</h3>{purchases.map(p=><article className="purchase" key={p.purchaseId}><div><strong>{p.packName}</strong><p>{p.lamports/1e9} devnet SOL · {p.status==='paid'?'Delivered':'Pending payment / confirmation'}</p></div>{p.status!=='paid'&&<button disabled={busy} onClick={()=>recover(p)}>Check payment</button>}</article>)}</section>}{pull.length > 0 && <section className="reveal"><h2>Your pull is in.</h2><p>Server-verified results · added to your collection</p><div className="grid">{pull.map((i, n) => <div className="revealed" style={{ animationDelay: `${n * .15}s` }} key={i.id}><CardView card={i.card} extra={<p>Serial #{i.serial}</p>}/></div>)}</div></section>}<div className="grid packs">{packs.map((p, n) => <article className="panel pack" key={p.id}><div className="pack-art"><span>VAULT</span><b>{String(n + 1).padStart(2, '0')}</b><small>{p.cardsPerPack} CARDS / PACK</small></div><h3>{p.name}</h3><details><summary>Published pull odds · v{p.oddsVersion}</summary><dl>{Object.entries(p.odds).map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v}%</dd></div>)}</dl></details><button className="primary" disabled={busy || !p.priceLamports} onClick={() => open(p)}>{p.priceLamports ? p.priceLamports / 1e9 : 'Unavailable'} SOL - Buy & open</button></article>)}</div>{packs.length === 0 && <p className="empty">No live packs yet. Refresh after a set is published.</p>}</>}
 {tab === 'Collection' && <><label className="filter">Rarity<select value={rarity} onChange={e => setRarity(e.target.value)}>{['all', 'common', 'rare', 'epic', 'legendary'].map(r => <option key={r}>{r}</option>)}</select></label>{Object.entries(groups).map(([id, entries]) => <section key={id}><h3>SET / {id.slice(0, 8)}</h3><div className="grid">{entries?.map(c => <CardView key={c.card.id} card={c.card} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))} extra={<p>{c.count} owned · {c.instances.map(i => `#${i.serial}${i.locked ? ' (locked)' : ''}`).join(', ')}</p>}/>)}</div></section>)}{cards.length === 0 && <p className="empty">Your collection starts with your first pack.</p>}</>}
 {tab === 'Trades' && <Marketplace onChange={refresh}/>}
 {tab === 'Leaderboard' && board && <div className="leader-layout"><section className="panel"><h3>TOP COLLECTORS</h3>{board.collectors.map((c, n) => <div className="rank" key={c.user.id}><b>{String(n + 1).padStart(2, '0')}</b><span>{c.user.displayName}</span><strong>{c.score} pts</strong></div>)}{!board.collectors.length && <p>No ranked collectors yet.</p>}</section><section><h3>TRENDING / SIMULATED ENGAGEMENT</h3><div className="grid">{board.trending.map(c => <CardView key={c.card.id} card={c.card} extra={<p className="hype">HYPE {c.hype}/100 · SIMULATED</p>} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))}/>)}</div></section></div>}
 {tab === 'Contribute' && <Contribute displayName={me.user.displayName}/>}

 </>}{detail && <div className="modal" role="dialog" aria-modal="true" aria-label="Card details" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><section className="panel"><button autoFocus onClick={() => setDetail(null)}>Close details ✕</button><CardView card={detail.card}/><p>Hype: {detail.stats.hype}/100 · simulated engagement</p><p>Set: {detail.card.setId}</p><p>Supply: {detail.card.maxSupply ?? 'Unlimited'}</p></section></div>}</main><footer>FAZE VAULT / DEMO COLLECTIBLES <span>Demo packs · Solana devnet payments.</span></footer></>;
}
