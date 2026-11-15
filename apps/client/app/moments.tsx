'use client';
import type { Card, CollectionEntry, DailyStatus, EraSet, Pack, SetProgress } from '@faze/shared';
import { useEffect, useState } from 'react';
import { art, request } from '../lib/api';
import { FazeCard, Icon, tierOf } from './arena-ui';

/*
 * The FaZe moments game, client side. Every number shown here comes from the server
 * (/sets, /me/sets, /me/daily, /me/cards, /packs); this file only decides how to present it
 * and what KAM suggests next. Nothing here grants coins or cards.
 */

export type Game = {
  sets: EraSet[];
  progress: SetProgress[];
  daily: DailyStatus | null;
  cards: CollectionEntry[];
  packs: Pack[];
  balance: number;
};

/* ---------------- KAM, the Killcam (original character) ---------------- */
export function Kam({ size = 120, mood = 'idle' }: { size?: number; mood?: 'idle' | 'hype' | 'roast' }) {
  return <svg className={`kam kam-${mood}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="KAM, the FaZe killcam robot">
    <g className="kam-body">
      <rect x="62" y="20" width="8" height="16" rx="3" fill="#222" />
      <circle cx="66" cy="18" r="5" fill="#e4002b" className="kam-rec" />
      <rect x="18" y="34" width="72" height="54" rx="12" fill="#e4002b" />
      <rect x="18" y="34" width="72" height="18" rx="10" fill="#b8001f" />
      <path d="M90 46 l18 -9 v42 l-18 -9z" fill="#1a1a1a" />
      <rect x="24" y="76" width="60" height="6" rx="3" fill="#7a0013" />
      <circle cx="50" cy="61" r="21" fill="#111" />
      <circle cx="50" cy="61" r="15" fill="#0b0b0b" stroke="#ff4060" strokeWidth="2" />
      <g className="kam-eye" stroke="#ff8095" strokeWidth="1.6"><path d="M50 49v8M50 65v8M38 61h8M54 61h8" /><circle cx="50" cy="61" r="2.4" fill="#ff8095" stroke="none" /></g>
      <circle cx="44" cy="54" r="3" fill="#fff" opacity=".55" />
      <rect x="74" y="40" width="10" height="5" rx="2" fill="#fff" opacity=".85" />
      <rect x="30" y="88" width="10" height="14" rx="4" fill="#1a1a1a" /><rect x="66" y="88" width="10" height="14" rx="4" fill="#1a1a1a" />
    </g>
  </svg>;
}

export function KamSays({ children, mood, action }: { children: React.ReactNode; mood?: 'idle' | 'hype' | 'roast'; action?: React.ReactNode }) {
  return <div className="kam-says"><Kam size={92} mood={mood} /><div className="bubble"><b>KAM</b><p>{children}</p>{action}</div></div>;
}

/* ---------------- derived state ---------------- */
export function ownedIds(cards: CollectionEntry[]) { return new Set(cards.map(c => c.card.id)); }
export function duplicates(cards: CollectionEntry[]) { return cards.reduce((n, c) => n + Math.max(0, c.count - 1), 0); }
function countdown(iso: string, now: number) {
  const ms = Math.max(0, Date.parse(iso) - now), h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
export function useNow(ms = 30000) { const [now, setNow] = useState(() => Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }

export type NextMove = { kind: 'daily' | 'claim' | 'trade' | 'pack' | 'wait' | 'coins' | 'done'; line: string; setId?: string; pack?: Pack };

/** KAM's single recommended next move, in a fixed priority order so the loop always makes sense. */
export function nextMove(g: Game, now: number): NextMove {
  if (g.daily?.available) return { kind: 'daily', line: `Free pack is up. Today's tape is from the ${g.daily.setName}. Rip it.` };
  const claimable = g.progress.find(p => p.complete && !p.claimed);
  if (claimable) { const s = g.sets.find(x => x.id === claimable.setId); return { kind: 'claim', setId: claimable.setId, line: `You finished ${s?.name ?? 'an era'}. Claim the ${s?.completionBonus ?? 0}-coin bonus and I'll play you the backstory.` }; }
  const open = g.progress.filter(p => !p.complete && g.sets.some(s => s.id === p.setId && !s.drop)).sort((a, b) => (b.owned / b.total) - (a.owned / a.total));
  const closest = open[0];
  const dupes = duplicates(g.cards);
  if (closest && dupes >= 2) { const s = g.sets.find(x => x.id === closest.setId); return { kind: 'trade', setId: closest.setId, line: `You're sitting on ${dupes} duplicates and ${closest.total - closest.owned} ${s?.name} moments are still missing. Trade the spares.` }; }
  if (closest) {
    const s = g.sets.find(x => x.id === closest.setId);
    const pack = g.packs.find(p => p.setId === closest.setId);
    if (pack && g.balance >= pack.priceCoins) return { kind: 'pack', setId: closest.setId, pack, line: `${s?.name} is ${closest.owned}/${closest.total}. A ${pack.name} costs ${pack.priceCoins}; you have ${g.balance}.` };
    if (g.daily) return { kind: 'wait', setId: closest.setId, line: `Out of coins for packs. Your next free pack drops in ${countdown(g.daily.nextAt, now)}. Or trade for what you're missing.` };
    return { kind: 'coins', line: 'Top up demo coins to keep collecting.' };
  }
  if (g.progress.length && g.progress.every(p => p.complete)) return { kind: 'done', line: 'Every era complete. You are the archive now. Watch for live drops.' };
  return { kind: 'wait', line: 'Open your first pack and I will start the tape.' };
}

/** KAM's reaction to a pull: hype for rare moments, a roast for a pile of repeat commons. */
export function kamReaction(pulled: Card[], ownedBefore: Set<string>) {
  const fresh = pulled.filter(c => !ownedBefore.has(c.id)).length;
  const rank: Record<Card['rarity'], number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const best = pulled.reduce((b, c) => (rank[c.rarity] > rank[b.rarity] ? c : b), pulled[0]);
  if (best?.rarity === 'legendary') return { mood: 'hype' as const, line: `Legendary. "${best.name}". I recorded that one myself.` };
  if (best?.rarity === 'epic') return { mood: 'hype' as const, line: `Epic pull: "${best.name}". That tape is worth rewinding.` };
  if (!fresh) return { mood: 'roast' as const, line: 'Zero new moments. I have seen better lobbies in a 2011 private match. Trade the dupes.' };
  return { mood: 'idle' as const, line: `${fresh} new ${fresh === 1 ? 'moment' : 'moments'} for the binder.` };
}

/* ---------------- binder ---------------- */
export function EraProgress({ owned, total }: { owned: number; total: number }) {
  const pct = total ? Math.round(owned / total * 100) : 0;
  return <div className="era-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={owned} aria-label={`${owned} of ${total} moments`}><i style={{ width: `${pct}%` }} /><span>{owned}/{total}</span></div>;
}

export function Binder({ g, focus, onCard, onClaim, onPack, onTrade, busy }: {
  g: Game; focus?: string; busy: boolean;
  onCard: (c: Card) => void; onClaim: (setId: string) => void; onPack: (p: Pack) => void; onTrade: () => void;
}) {
  const owned = new Map(g.cards.map(c => [c.card.id, c.count]));
  const eras = g.sets.filter(s => !s.drop);
  const [open, setOpen] = useState<string>(focus ?? eras[0]?.id ?? '');
  useEffect(() => { if (focus) setOpen(focus); }, [focus]);
  const set = eras.find(s => s.id === open) ?? eras[0];
  if (!set) return <p className="muted pad">No eras are live yet.</p>;
  const p = g.progress.find(x => x.setId === set.id);
  const pack = g.packs.find(x => x.setId === set.id);
  const missing = set.cards.filter(c => !owned.has(c.id));
  return <div className="binder">
    <div className="era-tabs" role="tablist" aria-label="Eras">{eras.map(s => { const q = g.progress.find(x => x.setId === s.id); return <button key={s.id} role="tab" aria-selected={s.id === set.id} onClick={() => setOpen(s.id)}><b>{s.name}</b><small>{s.era}</small>{q && <EraProgress owned={q.owned} total={q.total} />}{q?.complete && <i className="era-check" aria-label="complete">✓</i>}</button>; })}</div>
    <section className={`era-head era-${set.name.split(' ')[0].toLowerCase()}`}>
      <div><p className="era-years">{set.era}</p><h2>{set.name}</h2><p>{set.description}</p></div>
      <div className="era-actions">
        {p && <EraProgress owned={p.owned} total={p.total} />}
        {p?.complete && !p.claimed && <button className="pill pill-lilac" disabled={busy} onClick={() => onClaim(set.id)}>Claim {set.completionBonus} coins + backstory</button>}
        {!p?.complete && pack && <button className="pill pill-violet" disabled={busy || g.balance < pack.priceCoins} onClick={() => onPack(pack)}>{pack.name} · {pack.priceCoins}</button>}
        {!p?.complete && <button className="pill pill-dark" onClick={onTrade}>Trade for {missing.length} missing</button>}
      </div>
    </section>
    <div className="binder-grid">{set.cards.map(c => owned.has(c.id)
      ? <FazeCard key={c.id} card={c} onClick={() => onCard(c)} badge={owned.get(c.id)! > 1 ? `×${owned.get(c.id)}` : undefined} />
      : <button key={c.id} className={`slot-missing r-${c.rarity}`} onClick={() => onCard(c)} aria-label={`Missing: ${c.name}, ${tierOf(c)}`}><span className="sm-year">{c.momentOn?.slice(0, 4)}</span><Icon name="Lock" size={22} /><b>{c.name}</b><small>{tierOf(c)}</small></button>)}</div>
    <section className={`backstory${p?.backstory ? ' is-open' : ''}`}>
      <h3><Icon name={p?.backstory ? 'Play' : 'Lock'} size={16} />Era backstory</h3>
      {p?.backstory ? <p>{p.backstory}</p> : <p className="muted">Locked. Collect all {p?.total ?? set.cards.length} {set.name} moments to unlock KAM's tape{set.completionBonus ? ` and a ${set.completionBonus}-coin bonus` : ''}.</p>}
    </section>
  </div>;
}

/* ---------------- moment detail ---------------- */
export function MomentSheet({ card, g, onClose, onTrade, onPack }: { card: Card; g: Game; onClose: () => void; onTrade: () => void; onPack: (p: Pack) => void }) {
  const entry = g.cards.find(c => c.card.id === card.id);
  const set = g.sets.find(s => s.id === card.setId);
  const pack = g.packs.find(p => p.setId === card.setId);
  const date = card.momentOn ? new Date(card.momentOn + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null;
  return <div className="sheet" role="dialog" aria-modal="true" aria-label={card.name} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-panel card-detail"><button className="x" onClick={onClose} aria-label="Close" autoFocus><Icon name="Close" /></button>
      <div className={entry ? '' : 'is-locked-card'}><FazeCard card={card} /></div>
      <div className="detail-info">
        <small className={`rtag t-${tierOf(card).toLowerCase()}`}>{tierOf(card)}</small>
        <h2>{card.name}</h2>
        <p className="muted">{card.fazeMember}{date ? ` · ${date}` : ''}{set ? ` · ${set.name}` : ''}</p>
        {card.lore ? <div className="lore"><Kam size={40} /><p>{card.lore}</p></div> : <p className="muted">No archive entry for this card yet.</p>}
        {entry ? <p className="owned-line">In your binder: {entry.instances.map(i => `#${i.serial}${i.locked ? ' (in a trade)' : ''}`).join(', ')}{entry.count > 1 ? ` · ${entry.count - 1} spare to trade` : ''}</p>
          : <p className="owned-line miss">Not in your binder yet.{card.maxSupply ? ` Only ${card.maxSupply} will ever exist.` : ''}</p>}
        <div className="row">{entry && entry.count > 1 && <button className="pill pill-violet" onClick={onTrade}>Trade a spare</button>}{!entry && pack && <button className="pill pill-violet" disabled={g.balance < pack.priceCoins} onClick={() => onPack(pack)}>Open {pack.name} · {pack.priceCoins}</button>}{!entry && <button className="pill pill-dark" onClick={onTrade}>Find it on the market</button>}</div>
        <p className="fine-print">Lore is taken from the FaZe archive timeline. Demo collectible; art is an original placeholder.</p>
      </div>
    </div>
  </div>;
}

/* ---------------- live drops ---------------- */
export function Drops({ g, onPack, busy }: { g: Game; onPack: (p: Pack) => void; busy: boolean }) {
  const drops = g.sets.filter(s => s.drop);
  if (!drops.length) return <div className="pad-view"><KamSays>No live drop right now. When FaZe is live or a match turns, I flag the moment and it lands here as a limited pack. Being there is the point.</KamSays>
    <div className="how-drops"><article><b>1 · Spike</b><p>Chat and clip activity jump far above normal.</p></article><article><b>2 · Cut</b><p>Staff approve the moment and its card. Nothing ships unreviewed.</p></article><article><b>3 · Drop</b><p>A limited pack goes live here for fans who show up.</p></article></div></div>;
  return <div className="pad-view"><div className="drop-grid">{drops.map(s => { const pack = g.packs.find(p => p.setId === s.id); const p = g.progress.find(x => x.setId === s.id); return <article key={s.id} className="drop-card"><span className="live-dot">LIVE DROP</span><h3>{s.name}</h3><p>{s.description}</p>{p && <EraProgress owned={p.owned} total={p.total} />}<div className="mini-row">{s.cards.slice(0, 5).map(c => <FazeCard key={c.id} card={c} compact />)}</div>{pack && <button className="pill pill-violet wide" disabled={busy || g.balance < pack.priceCoins} onClick={() => onPack(pack)}>Open drop · {pack.priceCoins} coins</button>}</article>; })}</div></div>;
}

/* ---------------- clip submission ---------------- */
export function Clips() {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState(''), [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle'), [msg, setMsg] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setState('error'); setMsg('Max 2 MB.'); return; }
    setState('sending');
    try {
      const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file); });
      await request('/submissions/fan-art', { name, base64, mimeType: file.type });
      setState('sent'); setMsg('Sent to the moderation queue.'); setFile(null); setName('');
    } catch (err) { setState('error'); setMsg(err instanceof Error ? err.message : 'Upload failed.'); }
  }
  return <div className="pad-view clips">
    <KamSays>Clipped something legendary? Send me a frame. Staff review every submission. Approved moments can be cut into cards, credited to you.</KamSays>
    <form className="clip-form chamfer" onSubmit={submit}>
      <h2>Submit a moment</h2>
      <label className="field"><Icon name="Cards" size={16} /><input value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="What happened? e.g. 1v4 clutch on stream" aria-label="Moment title" /></label>
      <label className="drop-zone"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} required /><Icon name="Plus" size={22} /><span>{file ? file.name : 'Thumbnail or still · PNG, JPEG or WebP · 2 MB max'}</span></label>
      <button className="pill pill-lilac wide" disabled={state === 'sending' || !file}>{state === 'sending' ? 'Sending…' : 'Submit for review'}</button>
      {msg && <p className={state === 'error' ? 'miss' : 'ok'} role="status">{msg}</p>}
    </form>
  </div>;
}

/* ---------------- on this day ---------------- */
export function onThisDay(sets: EraSet[], now: number) {
  const today = new Date(now), md = (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  const all = sets.flatMap(s => s.cards).filter(c => c.momentOn);
  if (!all.length) return null;
  const dist = (c: Card) => { const d = new Date(c.momentOn + 'T00:00:00Z'); const x = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); const diff = Math.abs(x - md); return Math.min(diff, 1231 - diff); };
  return all.reduce((best, c) => dist(c) < dist(best) ? c : best, all[0]);
}

export function artOf(c: Card) { return art(c.artUrl); }
