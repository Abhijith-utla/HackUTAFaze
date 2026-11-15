'use client';
// Binder: eras -> sets -> cards, cards you don't own shown as teasers, a progress bar per set.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../../lib/api';
import CardDetail, { CardTile } from './card-detail';
import type { BinderCard, BinderEra } from './types';
import './binder.css';

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

export default function BinderTab() {
  const [eras, setEras] = useState<BinderEra[] | null>(null);
  const [open, setOpen] = useState<BinderCard | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setEras((await request<{ eras: BinderEra[] }>('/binder')).eras); setErr(''); }
    catch (e) { setErr(msg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!eras) return <div className="bd-root">{err ? <p className="bd-error" role="alert">{err} <button type="button" onClick={load}>Retry</button></p> : <p className="bd-muted">Opening your binder…</p>}</div>;
  const populated = eras.filter(e => e.sets.length);
  return <div className="bd-root">
    {err && <p className="bd-error" role="alert">{err}</p>}
    {populated.length === 0 && <p className="bd-muted">Nothing to show yet. Open a pack from the Store to start your binder.</p>}
    {populated.map(era => <section key={era.id}>
      <h3>{era.name}{era.starts ? <span className="bd-muted"> · {era.starts}{era.ends ? `–${era.ends}` : '+'}</span> : null}</h3>
      {era.sets.map(set => <div key={set.id} className="bd-set">
        <div className="bd-row"><strong>{set.name}</strong><span className="bd-muted">{set.owned} / {set.total}{set.complete ? ' · complete' : ''}</span></div>
        <div className={`bd-bar${set.complete ? ' is-done' : ''}`} style={{ '--v': `${set.total ? (set.owned / set.total) * 100 : 0}%` } as React.CSSProperties} role="progressbar" aria-valuemin={0} aria-valuemax={set.total} aria-valuenow={set.owned} aria-label={`${set.name} progress`}><i /></div>
        <div className="bd-grid">{set.cards.map(c => <CardTile key={c.card.id} card={c.card} missing={c.owned === 0}
          badge={c.owned > 1 ? `×${c.owned}` : undefined} onClick={() => c.owned > 0 && setOpen(c)}>
          {c.owned > 0 && <span className="bd-muted">#{c.instances.map(i => i.serial).join(', #')}</span>}</CardTile>)}</div>
      </div>)}
    </section>)}
    {open && <CardDetail card={open.card} instances={open.instances} onClose={() => setOpen(null)} />}
  </div>;
}
