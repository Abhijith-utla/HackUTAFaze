'use client';
// Battle tab: lineup builder, Vault bosses, progress. The server resolves every battle; this only picks a lineup and animates the log.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { art } from '../../lib/api';
import { battleRequest, createBattle, isNetworkError, mockMode, ruleConstants, teamBonuses } from './api';
import BattleReplay from './battle-replay';
import { SLOTS, STATS, type Battle, type BattleCard, type BattleProgress, type BattleRules, type BattleStat, type LineupCard, type VaultBoss } from './types';
import './battle.css';

const STORE_KEY = 'faze-battle-lineup';
const TIER_NAMES = ['Rookie', 'Pro', 'Elite', 'Legend'];
const RARITY_COLOR = { common: 'var(--rarity-common,#A4A4AA)', rare: 'var(--rarity-rare,#3D9BFF)', epic: 'var(--rarity-epic,#A35CFF)', legendary: 'var(--rarity-legendary,#F5B941)' };
type Lineup = [string | null, string | null, string | null];
type SortKey = BattleStat | 'cost' | 'rarity';
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

function newKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) { try { return crypto.randomUUID(); } catch { /* insecure context */ } }
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function readLineup(): Lineup {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); if (Array.isArray(v) && v.length === 3) return v.map(x => typeof x === 'string' ? x : null) as Lineup; } catch { /* storage blocked */ }
  return [null, null, null];
}
function saveLineup(l: Lineup) { try { localStorage.setItem(STORE_KEY, JSON.stringify(l)); } catch { /* storage blocked */ } }

export function StatBars({ stats, compact }: { stats: LineupCard['stats']; compact?: boolean }) {
  return <dl className={`bt-stats${compact ? ' is-compact' : ''}`}>{STATS.map(s => <div key={s} className={`bt-stat bt-stat-${s}`}>
    <dt>{s}{s === 'hype' && <small className="bt-sim">SIMULATED</small>}</dt>
    <dd><span className="bt-bar" aria-hidden="true"><i style={{ '--v': `${Math.min(99, Math.max(0, stats[s]))}%` } as CSSProperties} /></span><b>{stats[s]}</b></dd>
  </div>)}</dl>;
}

export function MiniCard({ entry, label }: { entry: LineupCard; label?: string }) {
  return <span className={`bt-mini r-${entry.card.rarity}`} style={{ '--rc': RARITY_COLOR[entry.card.rarity] } as CSSProperties}>
    <img src={art(entry.card.artUrl)} alt="" />
    <span><small>{label ?? entry.card.fazeMember}</small><b>{entry.card.name}</b></span>
  </span>;
}

export default function BattleTab({ onOpenStore }: { onOpenStore: () => void }) {
  const [cards, setCards] = useState<BattleCard[] | null>(null);
  const [bosses, setBosses] = useState<VaultBoss[]>([]);
  const [rules, setRules] = useState<BattleRules | null>(null);
  const [progress, setProgress] = useState<BattleProgress | null>(null);
  const [lineup, setLineup] = useState<Lineup>([null, null, null]);
  const [active, setActive] = useState(0);
  const [sort, setSort] = useState<SortKey>('power');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fighting, setFighting] = useState<string | null>(null);
  const [battle, setBattle] = useState<Battle | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const pending = useRef<{ sig: string; key: string } | null>(null);
  const mock = useMemo(() => mockMode(), []);
  const c = ruleConstants(rules);

  const loadMeta = useCallback(async () => {
    const [v, p] = await Promise.allSettled([battleRequest<{ bosses: VaultBoss[] }>('/battle/vault'), battleRequest<BattleProgress>('/me/battle-progress')]);
    if (v.status === 'fulfilled') setBosses([...v.value.bosses].sort((a, b) => a.tier - b.tier));
    if (p.status === 'fulfilled') setProgress(p.value);
    return v;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [list, , r] = await Promise.all([
          battleRequest<{ cards: BattleCard[] }>('/me/battle-cards'),
          loadMeta().then(v => { if (v.status === 'rejected' && live) setError(`Vault unavailable: ${v.reason instanceof Error ? v.reason.message : 'try Refresh'}`); }),
          battleRequest<BattleRules>('/battle/rules').catch(() => null),
        ]);
        if (!live) return;
        setRules(r);
        setCards(list.cards);
        const ids = new Set(list.cards.map(x => x.instanceId));
        const saved = readLineup().map(id => id && ids.has(id) ? id : null) as Lineup;
        setLineup(saved);
        setActive(Math.max(0, saved.indexOf(null)));
      } catch (e) {
        if (live) { setError(e instanceof Error ? e.message : 'Could not load battles.'); setCards(c => c ?? []); }
      }
    })();
    return () => { live = false; };
  }, [loadMeta]);

  const byId = useMemo(() => new Map((cards ?? []).map(x => [x.instanceId, x])), [cards]);
  const picked = lineup.map(id => id ? byId.get(id) ?? null : null);
  const cost = picked.reduce((s, x) => s + (x?.stats.cost ?? 0), 0);
  const full = picked.every(Boolean);
  const bonuses = teamBonuses(picked, c);
  const bonusTotal = bonuses.filter(b => b.on).reduce((s, b) => s + b.value, 0);
  const sorted = useMemo(() => [...(cards ?? [])].sort((a, b) => sort === 'rarity' ? RARITY_ORDER[b.card.rarity] - RARITY_ORDER[a.card.rarity] : sort === 'cost' ? b.stats.cost - a.stats.cost : b.stats[sort] - a.stats[sort]), [cards, sort]);

  function update(next: Lineup) { setLineup(next); saveLineup(next); setNotice(''); const gap = next.indexOf(null); if (gap >= 0) setActive(gap); }
  function place(id: string, slot: number) {
    const next = [...lineup] as Lineup, from = next.indexOf(id);
    if (from === slot) return;
    if (from >= 0) next[from] = next[slot];
    next[slot] = id;
    update(next);
  }
  function toggle(id: string) {
    const at = lineup.indexOf(id);
    if (at >= 0) { const next = [...lineup] as Lineup; next[at] = null; update(next); setActive(at); return; }
    const slot = lineup[active] === null ? active : lineup.indexOf(null);
    if (slot < 0) { setNotice('Lineup is full. Tap a slot to clear it, or drop a card onto it to swap.'); return; }
    place(id, slot);
  }
  function clearSlot(i: number) { if (lineup[i]) { const next = [...lineup] as Lineup; next[i] = null; update(next); } setActive(i); }
  function autoPick() {
    const list = cards ?? [];
    let best: { ids: BattleCard[]; score: number } | null = null;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (let k = j + 1; k < list.length; k++) {
      const trio = [list[i], list[j], list[k]];
      if (trio.reduce((s, x) => s + x.stats.cost, 0) > c.squadCap) continue;
      const raw = trio.reduce((s, x) => s + x.stats.power + x.stats.clutch + x.stats.style + x.stats.hype, 0) / 4;
      const score = raw + teamBonuses(trio, c).filter(b => b.on).reduce((s, b) => s + b.value, 0);
      if (!best || score > best.score) best = { ids: trio, score };
    }
    if (!best) { setNotice('Not enough cards for a squad under the cost cap yet.'); return; }
    // Highest Clutch closes (round 3 is worth 2 points).
    const [x, y, z] = [...best.ids].sort((a, b) => a.stats.clutch - b.stats.clutch);
    update([x.instanceId, y.instanceId, z.instanceId]);
  }

  async function fight(mode: 'vault' | 'practice', tier: number) {
    if (!full || fighting) return;
    const ids = lineup as string[];
    const sig = `${mode}:${tier}:${ids.join(',')}`;
    if (pending.current?.sig !== sig) pending.current = { sig, key: newKey() };
    setFighting(sig); setError(''); setNotice('');
    try {
      const result = await createBattle({ mode, tier, lineup: ids, idempotencyKey: pending.current.key });
      pending.current = null;
      setBattle(result);
      loadMeta();
    } catch (e) {
      if (isNetworkError(e)) setError('Connection dropped before the server answered. Press Fight again; it safely resumes the same fight.');
      else { pending.current = null; setError(e instanceof Error ? e.message : 'Battle failed.'); }
    } finally { setFighting(null); }
  }

  function onDrop(e: DragEvent, slot: number) { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (byId.has(id)) place(id, slot); }

  if (cards === null) return <div className="battle-root"><p className="bt-loading" role="status">Loading your fighters…</p></div>;

  const progressStrip = <section className="bt-progress" aria-label="Battle progress">
    <div><small>LEVEL</small><b>{progress?.level ?? '–'}</b></div>
    <div><small>XP</small><b>{progress ? progress.xp.toLocaleString() : '–'}</b></div>
    <div><small>RECORD</small><b>{progress ? `${progress.wins}W–${progress.losses}L` : '–'}</b></div>
    <div><small>VAULT CLEARS</small><b>{progress?.vaultClears ?? '–'}</b></div>
    <p>No stakes: cards are never lost and battles never pay coins.{mock && <span className="bt-mock"> MOCK DATA (?battleMock)</span>}</p>
  </section>;

  if (!cards.length) return <div className="battle-root">{progressStrip}{error && <p className="alert error" role="alert">{error}</p>}
    <section className="bt-empty panel"><p className="eyebrow">NO FIGHTERS YET</p><h3>Your cards can fight.</h3><p>Open a pack to get your first three fighters, then take on today’s Vault boss.</p><button className="primary" onClick={onOpenStore}>Open a pack</button></section></div>;

  return <div className="battle-root">
    {battle && <BattleReplay battle={battle} onClose={() => setBattle(null)} />}
    {progressStrip}
    {error && <p className="alert error" role="alert">{error}</p>}

    <section className="bt-builder" aria-labelledby="bt-lineup-title">
      <div className="bt-head"><div><p className="eyebrow">LINEUP</p><h3 id="bt-lineup-title">Three lanes. Closer is worth double.</h3></div>
        <div className="bt-head-actions"><button onClick={autoPick}>Auto-pick</button><button onClick={() => update([null, null, null])} disabled={!lineup.some(Boolean)}>Clear</button></div></div>
      <ol className="bt-slots">{SLOTS.map((slot, i) => {
        const entry = picked[i];
        return <li key={slot}><button className={`bt-slot${entry ? ' is-filled' : ''}${active === i && !entry ? ' is-active' : ''}${dragOver === i ? ' is-over' : ''}`}
          onClick={() => clearSlot(i)} onDragOver={e => { e.preventDefault(); setDragOver(i); }} onDragLeave={() => setDragOver(null)} onDrop={e => onDrop(e, i)}
          aria-label={entry ? `${slot}: ${entry.card.name}. Remove from lineup.` : `${slot}: empty. Select, then pick a card.`}>
          <span className="bt-slot-label">{slot} <small>· {c.roundPoints[i] ?? 1} PT{(c.roundPoints[i] ?? 1) > 1 ? 'S' : ''}</small></span>
          {entry ? <><MiniCard entry={entry} label={`#${entry.serial} · COST ${entry.stats.cost}`} /><span className="bt-slot-x" aria-hidden="true">×</span></> : <span className="bt-slot-empty">{active === i ? 'Pick a card ↓' : 'Empty'}</span>}
        </button></li>;
      })}</ol>
      <div className="bt-summary">
        <div className="bt-bonuses" aria-label="Team bonuses preview">{bonuses.map(b => <span key={b.key} className={`bt-chip${b.on ? ' is-on' : ''}`} title={b.hint}>{b.label} +{b.value}</span>)}<small>{bonusTotal ? `+${bonusTotal} every round` : 'Same set or three different members adds a bonus'}</small></div>
        <div className="bt-cost" aria-live="polite"><small>SQUAD COST</small><b>{cost}</b><span>Vault caps shown per tier</span></div>
      </div>
      {notice && <p className="bt-notice" role="status">{notice}</p>}

      <div className="bt-grid-head"><h4>YOUR CARDS · {cards.length}</h4><label>Sort<select value={sort} onChange={e => setSort(e.target.value as SortKey)}>{[...STATS, 'cost', 'rarity'].map(s => <option key={s} value={s}>{s}</option>)}</select></label></div>
      <div className="bt-grid">{sorted.map(x => {
        const at = lineup.indexOf(x.instanceId);
        return <button key={x.instanceId} className={`bt-card r-${x.card.rarity}${at >= 0 ? ' is-picked' : ''}`} style={{ '--rc': RARITY_COLOR[x.card.rarity] } as CSSProperties}
          draggable onDragStart={e => { e.dataTransfer.setData('text/plain', x.instanceId); e.dataTransfer.effectAllowed = 'move'; }}
          onClick={() => toggle(x.instanceId)} aria-pressed={at >= 0} aria-label={`${x.card.name}, ${x.card.rarity}, serial ${x.serial}${at >= 0 ? `, in ${SLOTS[at]} slot` : ''}`}>
          <span className="bt-card-art"><img src={art(x.card.artUrl)} alt="" loading="lazy" /><span className="bt-rarity">{x.card.rarity}</span>{at >= 0 && <span className="bt-picked">{SLOTS[at]}</span>}</span>
          <span className="bt-card-body"><small>{x.card.fazeMember} · #{x.serial}</small><b>{x.card.name}</b>
            <span className="bt-chips"><span className="bt-chip is-role">{x.stats.role}</span><span className="bt-chip">COST {x.stats.cost}</span></span>
            <StatBars stats={x.stats} compact /></span>
        </button>;
      })}</div>
    </section>

    <section className="bt-vault" aria-labelledby="bt-vault-title">
      <div className="bt-head"><div><p className="eyebrow">TODAY’S VAULT · DEMO</p><h3 id="bt-vault-title">Beat the boss, tier by tier.</h3></div></div>
      {!bosses.length && <p className="empty">No Vault bosses today. Check back after the daily reset.</p>}
      <div className="bt-tiers">{bosses.map(b => {
        const sigV = `vault:${b.tier}:${lineup.join(',')}`, sigP = `practice:${b.tier}:${lineup.join(',')}`;
        const over = b.costCap != null && cost > b.costCap;
        const reason = !full ? 'Pick 3 cards to fight' : over ? `Squad cost ${cost} is over this tier’s cap of ${b.costCap}` : b.attemptsLeft <= 0 ? 'No attempts left today' : '';
        return <article key={b.tier} className={`bt-tier t-${b.tier}${b.cleared ? ' is-cleared' : ''}`}>
          <div className="bt-tier-top"><span className="bt-tier-pill">TIER {b.tier} · {TIER_NAMES[b.tier - 1] ?? ''}</span>{b.cleared && <span className="bt-cleared">✓ CLEARED</span>}</div>
          <h4>{b.name}</h4>
          <div className="bt-tier-meta"><span aria-label={`${b.attemptsLeft} of ${c.vaultAttempts} attempts left`}>{Array.from({ length: Math.max(c.vaultAttempts, b.attemptsLeft) }, (_, n) => <i key={n} className={n < b.attemptsLeft ? 'on' : ''} />)} {b.attemptsLeft} left</span>
            <span className={`bt-chip${over ? ' is-over' : ''}`}>{b.costCap != null ? `COST CAP ${cost}/${b.costCap}` : 'NO COST CAP'}</span></div>
          <ul className="bt-boss-line">{b.lineup.map((x, n) => <li key={n}><MiniCard entry={x} label={SLOTS[n]} /><span className="bt-boss-stats">P{x.stats.power} C{x.stats.clutch} S{x.stats.style} H{x.stats.hype}</span></li>)}</ul>
          <div className="bt-tier-actions">
            <button className="primary" disabled={!!reason || !!fighting} onClick={() => fight('vault', b.tier)}>{fighting === sigV ? 'Fighting…' : pending.current?.sig === sigV ? 'Retry fight' : 'Fight'}</button>
            <button disabled={!full || over || !!fighting} onClick={() => fight('practice', b.tier)}>{fighting === sigP ? 'Starting…' : 'Practice'}</button>
          </div>
          {reason && <small className="bt-reason">{reason}</small>}
        </article>;
      })}</div>
      <p className="bt-fine">Practice uses no attempts and gives no rewards. First clear of each tier per day earns XP; Legend earns a badge.</p>
    </section>
  </div>;
}
