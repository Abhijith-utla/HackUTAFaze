"use client";
import { useState } from "react";
import { AreaChart, Heading, HBars, Kpi, Panel, StatusBadge, Toast } from "../_components/ui";
import { api, compact, n, useLoad, type Campaign } from "../_components/lib";

type Revenue = {
  purchases: { paid: number; paid24h: number; sol: number; payers: number; conversion: number; arppuSol: number; cluster: string };
  byBundle: { bundle: string; purchases: number; coins: number; sol: number }[];
  solByDay: { t: string; sol: number }[];
  economy: { issued: number; issuedBy: { signupBonus: number; purchased: number; adminGrant: number }; sunk: number; outstanding: number; sinkRatio: number };
  campaigns: { id: string; name: string; status: Campaign["status"]; priceCoins: number; pulls: number; collectors: number; coins: number; sponsorFeesUsd: number }[];
};
type Activation = { id: string; campaignId: string; campaignName: string; campaignStatus: Campaign["status"]; feeUsd: number; deliverables: string; status: "active" | "ended"; packOpens: number; collectorsReached: number; costPerCollectorUsd: number | null };
type Sponsor = { id: string; name: string; category: string; notes: string; status: "active" | "paused"; demo: boolean; activations: Activation[]; totalFeeUsd: number; collectorsReached: number; opens: number };

const CATEGORIES = ["energy_drink", "apparel", "tech", "gaming_hardware", "food_beverage", "auto", "entertainment", "other"];
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const label = (c: string) => c.replace(/_/g, " ");

export default function RevenuePage() {
  const rev = useLoad(() => api<Revenue>("/admin/control/revenue"), [], 15000);
  const sp = useLoad(() => api<{ sponsors: Sponsor[]; note: string }>("/admin/control/sponsors"), []);
  const camps = useLoad(() => api<{ campaigns: Campaign[] }>("/admin/control/campaigns"), []);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const r = rev.data;
  const eligible = (camps.data?.campaigns ?? []).filter((c) => ["approved", "live", "ended"].includes(c.status));

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); setToast({ msg: ok }); await Promise.all([sp.reload(), rev.reload()]); }
    catch (e) { setToast({ msg: (e as Error).message, kind: "err" }); }
    finally { setBusy(""); }
  }

  return (
    <>
      <Heading eyebrow="INTELLIGENCE / REVENUE & SPONSORS" title="Where the value comes from." />
      <p className="cr-lede">Coin bundles and direct pack purchases are Phantom payments on Solana devnet (test funds), fulfilled only after the server verifies them on-chain. Sponsor fees are demo contract values for reporting.</p>
      {rev.error && <p className="cr-error" role="alert">{rev.error}</p>}
      <div className="cr-kpis">
        <Kpi accent label="Devnet SOL received" value={r ? n(r.purchases.sol, 2) : "…"} sub={r ? `${n(r.purchases.paid)} verified payments · ${n(r.purchases.paid24h)} in 24h` : ""} />
        <Kpi label="Paying collectors" value={r ? n(r.purchases.payers) : "…"} sub={r ? `${Math.round(r.purchases.conversion * 100)}% conversion` : ""} />
        <Kpi label="SOL per payer" value={r ? n(r.purchases.arppuSol, 3) : "…"} sub="average, test funds" />
        <Kpi label="Coins outstanding" value={r ? compact(r.economy.outstanding) : "…"} sub={r ? `${compact(r.economy.issued)} issued · ${compact(r.economy.sunk)} spent` : ""} />
        <Kpi label="Coin sink ratio" value={r ? `${Math.round(r.economy.sinkRatio * 100)}%` : "…"} sub="spent on packs ÷ issued" />
        <Kpi label="Sponsor value" value={sp.data ? usd(sp.data.sponsors.reduce((t, s) => t + s.totalFeeUsd, 0)) : "…"} sub="demo contract values" />
      </div>
      <div className="cr-grid2">
        <Panel title="Devnet SOL per day, 14 days" note="verified purchases">
          {r && <AreaChart label="sol" color="#e6e6e6" points={r.solByDay.map((d) => ({ t: d.t, n: d.sol }))} />}
        </Panel>
        <Panel title="Coin economy" note="fans only">
          {r && (
            <HBars rows={[
              { label: "Signup bonus", value: r.economy.issuedBy.signupBonus, color: "#8b8b96" },
              { label: "Bought (devnet)", value: r.economy.issuedBy.purchased, color: "#d8d8d8" },
              { label: "Granted (demo)", value: r.economy.issuedBy.adminGrant, color: "#5f5f68" },
              { label: "Spent on packs", value: r.economy.sunk, color: "#e4002b" },
            ]} />
          )}
          {r && r.byBundle.length > 0 && <p className="cr-muted cr-small">Bundles: {r.byBundle.map((b) => `${b.bundle} ×${b.purchases} (${n(b.sol, 2)} SOL)`).join(" · ")}</p>}
        </Panel>
      </div>

      <Panel title="Campaign revenue" note="coins from the ledger for each drop's pack">
        <div className="cr-table-wrap">
          <table className="cr-table">
            <thead><tr><th>Campaign</th><th>Status</th><th className="num">Pack opens</th><th className="num">Collectors</th><th className="num">Coins</th><th className="num">Sponsor fees</th></tr></thead>
            <tbody>
              {r?.campaigns.map((c) => (
                <tr key={c.id}>
                  <td><a href={`/admin/control/campaigns/${c.id}`}><b>{c.name}</b></a></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="num">{n(c.pulls)}</td>
                  <td className="num">{n(c.collectors)}</td>
                  <td className="num">{n(c.coins)}</td>
                  <td className="num">{c.sponsorFeesUsd ? usd(c.sponsorFeesUsd) : "—"}</td>
                </tr>
              ))}
              {r && !r.campaigns.length && <tr><td colSpan={6} className="cr-muted">No launched campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="cr-grid2">
        <Panel title="Add a sponsor" note="youth-safe brands only">
          <form className="cr-form" onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const d = Object.fromEntries(new FormData(form));
            void act("sponsor", () => api("/admin/control/sponsors", "POST", { name: d.name, category: d.category, notes: d.notes }), `Sponsor “${d.name}” added.`).then(() => form.reset());
          }}>
            <label>Name<input name="name" required minLength={2} maxLength={80} placeholder="e.g. G FUEL" /></label>
            <label>Category<select name="category" defaultValue="energy_drink">{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></label>
            <label>Notes<input name="notes" maxLength={500} placeholder="Relationship, contacts kept outside this tool" /></label>
            <button disabled={!!busy}>Add sponsor</button>
            <p className="cr-muted cr-small">Gambling, betting, alcohol, tobacco and vape brands are refused by the server.</p>
          </form>
        </Panel>
        <Panel title="Attach to a campaign" note="approved, live or ended drops">
          <form className="cr-form" onSubmit={(e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            void act("activate", () => api(`/admin/control/sponsors/${d.sponsor}/activations`, "POST", { campaignId: d.campaign, feeUsd: Number(d.fee || 0), deliverables: d.deliverables }), "Sponsor attached to the drop.");
          }}>
            <label>Sponsor<select name="sponsor" required>{(sp.data?.sponsors ?? []).filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Campaign<select name="campaign" required>{eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Fee (USD, demo)<input name="fee" type="number" min={0} step={100} defaultValue={0} /></label>
            <label>Deliverables<input name="deliverables" maxLength={500} placeholder="Logo on pack art, drop announcement" /></label>
            <button disabled={!!busy || !eligible.length || !sp.data?.sponsors.some((s) => s.status === "active")}>Attach sponsor</button>
          </form>
        </Panel>
      </div>

      <Panel title="Sponsors" note={sp.data?.note}>
        {sp.data && !sp.data.sponsors.length && <p className="cr-muted">No sponsors yet.</p>}
        <div className="cr-sponsors">
          {sp.data?.sponsors.map((s) => (
            <article key={s.id} className={`cr-sponsor${s.status === "paused" ? " paused" : ""}`}>
              <header>
                <div><h3>{s.name}</h3><small className="cr-muted">{label(s.category)}{s.demo ? " · demo" : ""}{s.status === "paused" ? " · paused" : ""}</small></div>
                <div className="cr-row">
                  <span className="cr-stat"><b>{usd(s.totalFeeUsd)}</b>value</span>
                  <span className="cr-stat"><b>{n(s.collectorsReached)}</b>collectors</span>
                  <span className="cr-stat"><b>{n(s.opens)}</b>pack opens</span>
                  <button className="quiet cr-small" disabled={!!busy} onClick={() => act(`p-${s.id}`, () => api(`/admin/control/sponsors/${s.id}`, "PATCH", { status: s.status === "active" ? "paused" : "active" }), s.status === "active" ? "Sponsor paused." : "Sponsor resumed.")}>{s.status === "active" ? "Pause" : "Resume"}</button>
                </div>
              </header>
              {s.notes && <p className="cr-muted cr-small">{s.notes}</p>}
              {s.activations.length > 0 && (
                <table className="cr-table">
                  <thead><tr><th>Campaign</th><th>Deliverables</th><th className="num">Fee</th><th className="num">Reach</th><th className="num">Cost / collector</th><th /></tr></thead>
                  <tbody>
                    {s.activations.map((a) => (
                      <tr key={a.id}>
                        <td><a href={`/admin/control/campaigns/${a.campaignId}`}>{a.campaignName}</a> <StatusBadge status={a.campaignStatus} /></td>
                        <td>{a.deliverables || "—"}</td>
                        <td className="num">{usd(a.feeUsd)}</td>
                        <td className="num">{n(a.collectorsReached)}</td>
                        <td className="num">{a.costPerCollectorUsd === null ? "—" : usd(a.costPerCollectorUsd)}</td>
                        <td>{a.status === "active" ? <button className="quiet cr-small" disabled={!!busy} onClick={() => act(`e-${a.id}`, () => api(`/admin/control/sponsors/activations/${a.id}/end`, "POST"), "Activation ended.")}>End</button> : <span className="cr-muted cr-small">ended</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          ))}
        </div>
      </Panel>
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </>
  );
}
