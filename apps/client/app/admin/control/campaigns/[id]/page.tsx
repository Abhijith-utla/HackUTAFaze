"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AreaChart, Heading, HBars, Kpi, Panel, Rarity, StatusBadge, Toast } from "../../_components/ui";
import { api, artSrc, ago, dateLabel, n, RARITY_COLORS, useLoad, type Asset, type Campaign, type Moment } from "../../_components/lib";

type Detail = { campaign: Campaign; assets: Asset[]; moment: Moment | null };
type Metrics = { launched: boolean; pulls: number; collectors: number; demoCollectors: number; coinsSpent: number; cardsMinted: number; tradesInvolvingDrop: number; avgHype: number; attributedPurchases: number; attributedSol: number; attribution: string; rarityMix: { rarity: string; n: number }[]; pullsByMinute: { t: string; n: number }[] };

const STEPS: { key: Campaign["status"][]; label: string }[] = [
  { key: ["draft", "rejected"], label: "Draft" },
  { key: ["pending_approval"], label: "Approval" },
  { key: ["approved"], label: "Ready" },
  { key: ["live"], label: "Live" },
  { key: ["ended"], label: "Measured" },
];

function CardDraft({ a, editable, onSave, busy }: { a: Asset; editable: boolean; onSave: (patch: Partial<Asset>) => Promise<void>; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(a.name);
  const [lore, setLore] = useState(a.lore);
  const [rarity, setRarity] = useState(a.rarity);
  return (
    <article className={`cr-draft r-${a.rarity}`} style={{ borderColor: RARITY_COLORS[a.rarity] }}>
      <div className="cr-art">{a.artUrl ? <img src={artSrc(a.artUrl)} alt="" /> : <span>No art</span>}</div>
      {edit ? (
        <form className="cr-edit" onSubmit={async (e) => { e.preventDefault(); await onSave({ name, lore, rarity }); setEdit(false); }}>
          <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Rarity
            <select value={rarity} onChange={(e) => setRarity(e.target.value as Asset["rarity"])}>
              {["common", "rare", "epic", "legendary"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label>Lore<textarea value={lore} maxLength={400} rows={4} onChange={(e) => setLore(e.target.value)} required /></label>
          <div className="cr-row"><button disabled={busy}>Save</button><button type="button" className="quiet" onClick={() => setEdit(false)}>Cancel</button></div>
        </form>
      ) : (
        <>
          <div className="cr-draft-meta"><Rarity r={a.rarity} />{a.maxSupply && <small>max {n(a.maxSupply)}</small>}<small>power {a.basePower}</small></div>
          <h3>{a.name}</h3>
          <small className="cr-muted">{a.fazeMember}</small>
          <p className="cr-lore">{a.lore}</p>
          {a.duplicateOf && (
            <p className="cr-dup" role="alert">Possible duplicate of “{a.duplicateName}” ({Math.round((a.similarity ?? 0) * 100)}% similar). Rename before approval.</p>
          )}
          {editable && <button className="quiet cr-small" onClick={() => setEdit(true)}>Edit</button>}
          {a.cardId && <span className="badge live">minted card</span>}
        </>
      )}
    </article>
  );
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const d = useLoad(() => api<Detail>(`/admin/control/campaigns/${id}`), [id]);
  const status = d.data?.campaign.status;
  const m = useLoad(() => (status === "live" || status === "ended" ? api<Metrics>(`/admin/control/campaigns/${id}/metrics`) : Promise.resolve(null)), [id, status], status === "live" ? 3000 : 0);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const [rights, setRights] = useState(false);
  const [rightsNote, setRightsNote] = useState("Moment from the team's FaZe timeline archive; card art is original demo seed art.");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [sim, setSim] = useState(12);

  async function act(key: string, fn: () => Promise<Detail | void>, okMsg?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (r) d.setData(r);
      if (okMsg) setToast({ msg: okMsg });
      await m.reload();
    } catch (e) {
      setToast({ msg: (e as Error).message, kind: "err" });
    } finally {
      setBusy("");
    }
  }

  if (d.error) return <p className="cr-error" role="alert">{d.error}</p>;
  if (!d.data) return <p className="cr-muted">Loading campaign…</p>;
  const { campaign: c, assets, moment } = d.data;
  const step = STEPS.findIndex((s) => s.key.includes(c.status));
  const dupes = assets.filter((a) => a.duplicateOf).length;
  const editable = c.status === "draft" || c.status === "rejected";
  const metrics = m.data;

  return (
    <>
      <Heading eyebrow={`CAMPAIGN / ${c.generator === "template" ? "TEMPLATE WRITER" : c.generator.toUpperCase()}`} title={c.name}>
        <StatusBadge status={c.status} />
      </Heading>
      <ol className="cr-steps" aria-label="Campaign progress">
        {STEPS.map((s, i) => <li key={s.label} className={i < step ? "done" : i === step ? "now" : ""}><span>{i + 1}</span>{s.label}</li>)}
      </ol>

      {moment && (
        <Panel title="Source moment" note={`${dateLabel(moment.occurredOn, moment.precision)} · ${moment.members.join(", ") || "FaZe Clan"}`}>
          <p className="cr-reco">{c.pitch}</p>
          <blockquote>{moment.summary}<cite>{moment.source}{moment.citations.length ? ` · cites ${moment.citations.join(", ")}` : ""}</cite></blockquote>
        </Panel>
      )}

      {(c.status === "live" || c.status === "ended") && metrics?.launched && (
        <Panel title={c.status === "live" ? "Live drop" : "Final results"} note={c.status === "live" ? <span className="cr-live"><i className="cr-pulse" /> refreshing every 3s · launched {ago(c.launchedAt)}</span> : `ran ${ago(c.launchedAt)} → ${ago(c.endedAt)}`}>
          <div className="cr-kpis">
            <Kpi accent label="Pack opens" value={n(metrics.pulls)} sub={`${n(c.packPriceCoins)} coins each`} />
            <Kpi label="Collectors" value={n(metrics.collectors)} sub={metrics.demoCollectors ? `${n(metrics.demoCollectors)} simulated (demo)` : "all real"} />
            <Kpi label="Coins spent" value={n(metrics.coinsSpent)} sub="from the ledger" />
            <Kpi label="Cards minted" value={n(metrics.cardsMinted)} sub={`avg hype ${metrics.avgHype}/100`} />
            <Kpi label="Trades with drop cards" value={n(metrics.tradesInvolvingDrop)} />
            <Kpi label="Attributed devnet SOL" value={n(metrics.attributedSol, 2)} sub={`${n(metrics.attributedPurchases)} purchases · test funds`} />
          </div>
          <div className="cr-grid2">
            <div><p className="eyebrow">PACK OPENS PER MINUTE</p><AreaChart label="drop" points={metrics.pullsByMinute} height={120} /></div>
            <div><p className="eyebrow">RARITY MIX PULLED</p><HBars rows={["legendary", "epic", "rare", "common"].map((r) => ({ label: r, value: metrics.rarityMix.find((x) => x.rarity === r)?.n ?? 0, color: RARITY_COLORS[r] }))} /></div>
          </div>
          <p className="cr-muted cr-small">Attribution: {metrics.attribution}.</p>
        </Panel>
      )}

      <Panel title={`Card drafts (${assets.length})`} note={dupes ? <span className="cr-warn">{dupes} possible duplicate{dupes > 1 ? "s" : ""}</span> : "no duplicates against the existing catalog"}>
        <div className="cr-drafts">
          {assets.map((a) => (
            <CardDraft key={a.id + a.name + a.lore + a.rarity} a={a} editable={editable} busy={!!busy}
              onSave={(patch) => act(`asset-${a.id}`, () => api<Detail>(`/admin/control/campaigns/${c.id}/assets/${a.id}`, "PATCH", patch), "Draft updated and re-checked for duplicates.")} />
          ))}
        </div>
      </Panel>

      <Panel title="Next step">
        {editable && (
          <div className="cr-row">
            {c.status === "rejected" && c.reviewNote && <p className="cr-dup">Reviewer: {c.reviewNote}</p>}
            <button onClick={() => act("submit", () => api<Detail>(`/admin/control/campaigns/${c.id}/submit`, "POST"), "Sent for approval.")} disabled={!!busy}>Submit for approval</button>
            <button className="quiet" onClick={() => act("regen", () => api<Detail>(`/admin/control/campaigns/${c.id}/regenerate`, "POST"), "Drafts regenerated from the archive.")} disabled={!!busy}>Regenerate drafts</button>
          </div>
        )}
        {c.status === "pending_approval" && (
          <form className="cr-review" onSubmit={(e) => e.preventDefault()}>
            <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I confirm we have the rights to use this moment, the member names and the card art for a collectible drop.</label>
            <label>Rights note<input value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} maxLength={500} /></label>
            <label>Reviewer note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
            <div className="cr-row">
              <button disabled={!!busy || !rights || dupes > 0} onClick={() => act("approve", () => api<Detail>(`/admin/control/campaigns/${c.id}/review`, "POST", { decision: "approve", rightsConfirmed: rights, rightsNote, note }), "Approved. Ready to launch from Campaign Command.")}>Approve drop</button>
              <button className="quiet" disabled={!!busy} onClick={() => act("reject", () => api<Detail>(`/admin/control/campaigns/${c.id}/review`, "POST", { decision: "reject", rightsConfirmed: rights, rightsNote, note: note || "Changes requested" }), "Sent back to draft.")}>Request changes</button>
            </div>
            {dupes > 0 && <p className="cr-warn">Approval is blocked until duplicate names are resolved.</p>}
          </form>
        )}
        {c.status === "approved" && (
          <div className="cr-row">
            <label className="cr-inline">Pack price (coins)<input type="number" min={1} value={price === "" ? c.packPriceCoins : price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} /></label>
            <button onClick={() => act("launch", () => api<Detail>(`/admin/control/campaigns/${c.id}/launch`, "POST", { packPriceCoins: price === "" ? c.packPriceCoins : price }), "Drop is live in the fan store.")} disabled={!!busy}>{busy === "launch" ? "Publishing set, cards, pack…" : "Launch drop"}</button>
            <span className="cr-muted">Approved {ago(c.reviewedAt)} · rights: {c.rightsNote || "confirmed"}</span>
          </div>
        )}
        {c.status === "live" && (
          <div className="cr-row">
            <label className="cr-inline">Demo collectors<input type="number" min={1} max={40} value={sim} onChange={(e) => setSim(Number(e.target.value))} /></label>
            <button className="quiet" onClick={() => act("sim", async () => { const r = await api<{ packsOpened: number }>(`/admin/control/campaigns/${c.id}/simulate`, "POST", { collectors: sim }); setToast({ msg: `${sim} demo collectors opened ${r.packsOpened} packs through the real pack-open path.` }); })} disabled={!!busy}>{busy === "sim" ? "Simulating…" : "Simulate demo collectors"}</button>
            <button onClick={() => act("end", () => api<Detail>(`/admin/control/campaigns/${c.id}/end`, "POST"), "Drop ended: pack deactivated, set retired.")} disabled={!!busy}>End drop</button>
            <span className="cr-muted">Or open the pack yourself in the fan app.</span>
          </div>
        )}
        {c.status === "ended" && <p className="cr-muted">This drop is closed. Results above are final. <Link href="/admin/control/kam">Find the next moment →</Link></p>}
      </Panel>
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </>
  );
}
