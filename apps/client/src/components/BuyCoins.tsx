"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { buyCoins } from "@/lib/payments";
import type { SolBundle } from "@/lib/types";

export function BuyCoins({ onBalance }: { onBalance: (n: number) => void }) {
  const [bundles, setBundles] = useState<SolBundle[]>([]);
  const [status, setStatus] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api.bundles().then((r) => setBundles(r.bundles)).catch((e) => setErr(e.message)); }, []);
  async function buy(id: string) {
    setBusy(true); setErr("");
    try { onBalance(await buyCoins(id, setStatus)); setStatus("Payment received (devnet, demo coins)."); }
    catch (e) { setStatus(""); setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <h2>Buy coins <span className="badge">devnet · demo</span></h2>
      <p className="mute">Pay with devnet SOL via Phantom (set Phantom to Devnet). Test funds only; coins are not cashable.</p>
      <div className="grid">
        {bundles.map((b) => (
          <div className="card" key={b.id}>
            <strong>{b.coins} coins</strong>
            <div className="mute">{b.lamports ? `${b.lamports / 1e9} SOL` : ""}</div>
            <button disabled={busy} onClick={() => buy(b.id)}>Buy</button>
          </div>))}
      </div>
      {status && <p role="status">{status}</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}
