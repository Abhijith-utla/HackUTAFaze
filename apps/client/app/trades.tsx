'use client';
import { useEffect, useState } from 'react';
import type { CollectionEntry, Trade } from '@faze/shared';
import { request } from '../lib/api';
type Run = (fn: () => Promise<void>) => Promise<void>;
export default function Trades({ busy, run, notify }: {
    busy: boolean;
    run: Run;
    notify: (s: string) => void;
}) {
    const [users, setUsers] = useState<{
        id: string;
        displayName: string;
    }[]>([]), [recipient, setRecipient] = useState(''), [mine, setMine] = useState<CollectionEntry[]>([]), [theirs, setTheirs] = useState<CollectionEntry[]>([]), [offered, setOffered] = useState<string[]>([]), [requested, setRequested] = useState<string[]>([]), [trades, setTrades] = useState<{
        incoming: Trade[];
        outgoing: Trade[];
    }>({ incoming: [], outgoing: [] });
    async function refresh() { setTrades(await request('/me/trades')); setMine((await request<{
        cards: CollectionEntry[];
    }>('/me/cards')).cards); }
    useEffect(() => { run(refresh); }, []);
    const toggle = (id: string, list: string[], setter: (v: string[]) => void) => setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    function picker(items: CollectionEntry[], selected: string[], setter: (v: string[]) => void) { return <div className="picker">{items.flatMap(e => e.instances.map(i => <label key={i.id}><input type="checkbox" disabled={busy || i.locked} checked={selected.includes(i.id)} onChange={() => toggle(i.id, selected, setter)}/><span>{e.card.name} <small>#{i.serial} · {e.card.rarity}{i.locked ? ' · locked' : ''}</small></span></label>))}{!items.length && <p>No cards to select.</p>}</div>; }
    return <><section className="panel"><h3>MAKE A TRADE</h3><form onSubmit={e => { e.preventDefault(); const q = String(new FormData(e.currentTarget).get('query')); run(async () => setUsers((await request<{
        users: {
            id: string;
            displayName: string;
        }[];
    }>(`/users?q=${encodeURIComponent(q)}`)).users)); }}><label>Find collector<input name="query" placeholder="Search approved display names"/></label><button disabled={busy}>Search</button></form><div className="user-results">{users.map(u => <button className={recipient === u.id ? 'selected' : ''} key={u.id} disabled={busy} onClick={() => run(async () => { setRecipient(u.id); setRequested([]); setTheirs((await request<{
        cards: CollectionEntry[];
    }>(`/users/${u.id}/collection`)).cards); })}>{u.displayName}</button>)}</div>{recipient && <form onSubmit={e => { e.preventDefault(); const message = String(new FormData(e.currentTarget).get('message') ?? ''); run(async () => { await request('/trades', { toUserId: recipient, offeredInstanceIds: offered, requestedInstanceIds: requested, message: message || undefined }); setOffered([]); setRequested([]); await refresh(); setTheirs((await request<{
        cards: CollectionEntry[];
    }>(`/users/${recipient}/collection`)).cards); notify('Offer sent. Cards are locked until the offer is resolved.'); }); }}><div className="trade-columns"><section><h4>You offer</h4>{picker(mine, offered, setOffered)}</section><section><h4>You request</h4>{picker(theirs, requested, setRequested)}</section></div><label>Message (reviewed before others see it)<textarea name="message" maxLength={200}/></label><button className="primary" disabled={busy || (!offered.length && !requested.length)}>Send offer</button></form>}</section><div className="trade-columns">{(['incoming', 'outgoing'] as const).map(side => <section key={side}><h3>{side.toUpperCase()}</h3>{trades[side].map(t => <article className="panel" key={t.id}><h4>{side === 'incoming' ? t.fromUser.displayName : t.toUser.displayName}</h4><p>{t.offeredInstanceIds.length} offered ↔ {t.requestedInstanceIds.length} requested</p><p>{t.message ?? (t.messageStatus === 'pending' ? 'Message awaiting moderation' : 'No message')}</p><small>{t.status} · {new Date(t.createdAt).toLocaleString()}</small>{t.status === 'open' && <div className="actions">{(side === 'incoming' ? ['accept', 'decline'] : ['cancel']).map(action => <button disabled={busy} key={action} onClick={() => run(async () => { await request(`/trades/${t.id}/${action}`, {}); await refresh(); notify(`Trade ${action} completed.`); })}>{action}</button>)}</div>}</article>)}{!trades[side].length && <p className="empty">No {side} offers.</p>}</section>)}</div></>;
}
