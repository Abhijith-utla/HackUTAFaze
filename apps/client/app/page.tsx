'use client';
import Brand from './brand';
import Image from 'next/image';
import ClipClash from './clip-clash';
import type { Card, CardInstance, CollectionEntry, MeResponse, Pack, Trade, LeaderboardResponse } from '@faze/shared';
import { useEffect, useState } from 'react';
import { API, PAYMENTS, ApiError, art, request } from '../lib/api';
import { packCoverForName } from '../lib/pack-covers';
import { buyPack, confirmPackPurchase, clearPackCheckout, type PackPurchase } from '../lib/phantom';
import Marketplace from './marketplace';
import ProfileMenu from './profile-menu';
import LeaderboardTab from './leaderboard';
import LivePill from './live-pill';
import PackOpening from './pack-opening';
import Contribute from './contribute';
import BinderTab from './binder/binder';
function CardView({ card, extra, onClick }: {
    card: Card;
    extra?: React.ReactNode;
    onClick?: () => void;
}) { return <button className={`card ${card.rarity}`} onClick={onClick}><div className="art"><img src={art(card.artUrl)} alt={card.name}/><span className="rarity">{card.rarity}</span></div><small>{card.fazeMember}</small><h3>{card.name}</h3><div className="card-meta"><span>POWER {card.basePower}</span>{card.demo && <span>DEMO</span>}</div>{extra}</button>; }
export default function Home() {
    const [tab, setTab] = useState('Store'), [me, setMe] = useState<MeResponse | null>(null), [packs, setPacks] = useState<Pack[]>([]), [cards, setCards] = useState<CollectionEntry[]>([]), [board, setBoard] = useState<LeaderboardResponse | null>(null), [pull, setPull] = useState<CardInstance[]>([]), [detail, setDetail] = useState<{
        card: Card;
        stats: {
            hype: number;
        };
    } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false), [signup, setSignup] = useState(false), [rarity, setRarity] = useState('all');
    const [opening, setOpening] = useState(false);
    const [openingPackName, setOpeningPackName] = useState('');
    // Silent recovery: a payment that was sent (we hold its signature) but not yet delivered is confirmed and opened without any UI.
    async function recoverPaid(userId: string) { const list = (await request<{purchases:PackPurchase[]}>('/me/pack-purchases')).purchases; for (const p of list.filter(x => x.status !== 'paid')) { let saved: { signature?: string } | null = null; try { saved = JSON.parse(localStorage.getItem(`faze.pack.${userId}.${p.packId}`) || 'null'); } catch {} if (!saved?.signature) continue; try { const result = await confirmPackPurchase(p.purchaseId, saved.signature); clearPackCheckout(userId, p.packId, p.purchaseId); if (result.cards) { setPull(result.cards); setOpeningPackName(p.packName); setOpening(true); } await refresh(); setNotice('Payment verified. Your pack is in your collection.'); return; } catch { /* still confirming; try again next visit */ } } }
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
        setBoard(await request<LeaderboardResponse>('/leaderboard')); if (tab === 'Store') await recoverPaid(me.user.id).catch(() => {});  }); }, [tab, me?.user.id]);
    async function authenticate(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const data = new FormData(e.currentTarget); await run(async () => { await request(signup ? '/auth/signup' : '/auth/login', { email: data.get('email'), password: data.get('password'), ...(signup ? { displayName: data.get('displayName') } : {}) }); await refresh(); }); }
    async function open(pack:Pack) { if (!me) return; await run(async()=>{try{const result=await buyPack(pack.id,me.user.id,setNotice);if(result.cards){setPull(result.cards);setOpeningPackName(pack.name);setOpening(true);}await refresh();}finally{}}); }
    // Not Object.groupBy: it is missing on iOS Safari < 17.4.
    const groups: Record<string, CollectionEntry[]> = {};
    for (const c of cards) if (rarity === 'all' || c.card.rarity === rarity) (groups[c.card.setId] ??= []).push(c);
    if (!ready || !me) return <main className="login-screen"><div className="login-stage" aria-hidden="true">{['a', 'b', 'c', 'd', 'e'].map(k => <img key={k} className={`lc lc-${k}`} src={`/login-cards/${k}.webp`} alt="" draggable={false} />)}</div><div className="login-center">{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}{!ready ? <p className="loading">Loading…</p> : <div className="login-panel"><section className="auth panel"><h2>ClipDeck</h2><p className="auth-tagline">{signup ? 'Join the collection.' : 'Collect moments. Build your legacy.'}</p>{tab === 'Contribute' && <p>Sign in or create a fan account to pitch a moment and connect your reward wallet.</p>}<form onSubmit={authenticate}>{signup && <label><span className="sr-only">Display name</span><input placeholder="Display name" name="displayName" required minLength={2} maxLength={24}/></label>}<label><span className="sr-only">Email</span><input placeholder="Email" type="email" name="email" required autoComplete="email"/></label><label><span className="sr-only">Password</span><input placeholder="Password" type="password" name="password" required minLength={8} autoComplete={signup ? 'new-password' : 'current-password'}/></label><button className="primary" disabled={busy}>{signup ? 'Create account' : 'Sign in'}</button></form><button onClick={() => setSignup(!signup)}>{signup ? 'Already collecting? Log in' : 'New here? Create an account'}</button><p className="login-fine">Open packs. Find your icons. Trade your way to the top.</p></section></div>}</div></main>;
    return <>{opening && pull.length > 0 && <PackOpening cards={pull} packName={openingPackName} onClose={() => setOpening(false)} />}<header><Brand /><div className="account"><a className="header-watch" href="/watch"><span className="hw-dot" aria-hidden="true" />WATCH</a><LivePill/>{me && <ProfileMenu name={me.user.displayName} role={me.user.role} onSignOut={() => run(async () => { await request('/auth/logout', {}); setMe(null); setCards([]); setPull([]); })} />}</div></header><main><nav aria-label="Main navigation">{['Store', 'Collection', 'Binder', 'Trades', 'Leaderboard', 'Game', 'Contribute'].map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setDetail(null); setPull([]); setError(''); setNotice(''); }}>{t}</button>)}</nav>{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}{busy && <p role="status" className="loading">Working…</p>}{!ready ? <p>Loading your vault…</p> : !me ? null : <>
 {tab === 'Store' && <section className="home-hero" aria-label="Open your packs"><div className="home-hero-panel"><div className="home-hero-copy"><h1>Open<br />your<br />packs</h1><p>Collect the moments that made FaZe. Build your legacy.</p><button type="button" className="home-cta" onClick={() => document.getElementById('packs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Open packs <span aria-hidden="true">↓</span></button></div></div><img className="home-team" src="/home/team.webp" alt="FaZe Clan creators celebrating" draggable={false} /><div className="home-packs" aria-hidden="true"><img className="hp hp-l" src="/pack-covers/03_faze_house.webp" alt="" draggable={false} /><img className="hp hp-c" src="/pack-covers/04_gaming_legends.webp" alt="" draggable={false} /><img className="hp hp-r" src="/pack-covers/02_og_trickshot.webp" alt="" draggable={false} /></div></section>}
 <div id="packs" className="section-title"><h2>{tab === 'Store' ? 'Packs' : tab}</h2><button disabled={busy} onClick={() => run(async () => { await refresh(); setPacks((await request<{
            packs: Pack[];
        }>('/packs')).packs); if (tab === 'Leaderboard')
            setBoard(await request<LeaderboardResponse>('/leaderboard')); })}>↻ Refresh</button></div>
 {tab === 'Store' && <><div className="grid packs">{packs.map((p) => <article className="panel pack" key={p.id}><div className="pack-art"><Image src={packCoverForName(p.name)} alt={`${p.name} cover`} fill sizes="(max-width: 760px) 100vw, 320px" /></div><h3>{p.name}</h3><details><summary>Published pull odds · v{p.oddsVersion}</summary>{(p as Pack & { guaranteed?: string[] }).guaranteed?.length ? <ul className="odds-guarantees">{(p as Pack & { guaranteed?: string[] }).guaranteed!.map(g => <li key={g}>{g}</li>)}</ul> : <dl>{Object.entries(p.odds).map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v}%</dd></div>)}</dl>}</details><button className="primary" disabled={busy || !p.priceLamports} onClick={() => open(p)}>{p.priceLamports ? `Buy with Phantom · ${p.priceLamports / 1e9} SOL` : 'Unavailable'}</button></article>)}</div>{packs.length === 0 && <p className="empty">No live packs yet. Refresh after a set is published.</p>}</>}
 {tab === 'Collection' && <><label className="filter">Rarity<select value={rarity} onChange={e => setRarity(e.target.value)}>{['all', 'common', 'rare', 'epic', 'legendary'].map(r => <option key={r}>{r}</option>)}</select></label>{Object.entries(groups).map(([id, entries]) => <section key={id}><h3>SET / {id.slice(0, 8)}</h3><div className="grid">{entries?.map(c => <CardView key={c.card.id} card={c.card} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))} extra={<p>{c.count} owned · {c.instances.map(i => `#${i.serial}${i.locked ? ' (locked)' : ''}`).join(', ')}</p>}/>)}</div></section>)}{cards.length === 0 && <p className="empty">Your collection starts with your first pack.</p>}</>}
 {tab === 'Game' && <ClipClash userId={me.user.id}/>}
 {tab === 'Binder' && <BinderTab/>}
 {tab === 'Trades' && <Marketplace onChange={refresh}/>}
 {tab === 'Leaderboard' && board && <LeaderboardTab board={board} meId={me.user.id} trending={<div className="grid">{board.trending.map(c => <CardView key={c.card.id} card={c.card} extra={<p className="hype">HYPE {c.hype}/100 · SIMULATED</p>} onClick={() => run(async () => setDetail(await request(`/cards/${c.card.id}`)))}/>)}</div>}/>}
 {tab === 'Contribute' && <Contribute displayName={me.user.displayName}/>}

 </>}{detail && <div className="modal" role="dialog" aria-modal="true" aria-label="Card details" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><section className="panel"><button autoFocus onClick={() => setDetail(null)}>Close details ✕</button><CardView card={detail.card}/><p>Hype: {detail.stats.hype}/100 · simulated engagement</p><p>Set: {detail.card.setId}</p><p>Supply: {detail.card.maxSupply ?? 'Unlimited'}</p></section></div>}</main><footer>FAZE CLIPDECK / DEMO COLLECTIBLES <span>Demo packs · Solana devnet payments.</span></footer></>;
}
