"use client";
import { useEffect, useState } from "react";
import type { Pack, CardInstance } from "@faze/shared";
import { api } from "@/lib/api";
import { CardTile } from "@/components/CardTile";
import { BuyCoins } from "@/components/BuyCoins";

export default function Store() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [pulled, setPulled] = useState<CardInstance[]>([]);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api.packs().then((r) => setPacks(r.packs)).catch((e) => setErr(e.message)); }, []);

  async function open(p: Pack) {
    setBusy(true); setErr(""); setPulled([]);
    try { const r = await api.openPack(p.id, crypto.randomUUID()); setPulled(r.cards); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (<>
    <h1>Store</h1>
    <BuyCoins onBalance={() => window.location.reload()} />
    {err && <p className="err" role="alert">{err}</p>}
    {packs.map((p) => (
      <div className="card" key={p.id} style={{ marginBottom: 12 }}>
        <h2>{p.name} <span className="badge">demo</span></h2>
        <p>{p.cardsPerPack} cards · {p.priceCoins} coins</p>
        <table className="mute"><tbody>{Object.entries(p.odds).map(([r, v]) => (<tr key={r}><td>{r}</td><td>{v}%</td></tr>))}</tbody></table>
        <p className="mute">Odds v{p.oddsVersion}, rolled on the server.</p>
        <button disabled={busy} onClick={() => open(p)}>{busy ? "Opening…" : "Open pack"}</button>
      </div>))}
    <div className="grid">{pulled.map((c, i) => <CardTile key={c.id} card={c.card} serial={c.serial} delay={i * 400} />)}</div>
  </>);
}
