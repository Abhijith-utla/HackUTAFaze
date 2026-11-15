"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Heading, Panel, ScoreBar, Toast } from "../_components/ui";
import { api, ago, dateLabel, SIGNAL_COLORS, useLoad, type Moment, type Opportunity } from "../_components/lib";

type Kam = { scanId: string | null; scannedAt: string | null; opportunities: Opportunity[]; scanned?: number };

export default function KamPage() {
  const router = useRouter();
  const kam = useLoad(() => api<Kam>("/admin/control/kam"));
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<(Moment & { rank: number })[] | null>(null);

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try { return await fn(); } catch (e) { setToast({ msg: (e as Error).message, kind: "err" }); } finally { setBusy(""); }
  }
  const scan = () => act("scan", async () => {
    const r = await api<Kam>("/admin/control/kam/scan", "POST");
    kam.setData(r);
    setOpen(r.opportunities[0]?.id ?? null);
    setToast({ msg: `KAM scanned ${r.scanned} archive moments against live collector data.` });
  });
  const createCampaign = (o: Opportunity) => act(o.id, async () => {
    const r = await api<{ campaign: { id: string } }>("/admin/control/campaigns", "POST", { opportunityId: o.id });
    router.push(`/admin/control/campaigns/${r.campaign.id}`);
  });
  const dismiss = (o: Opportunity) => act(o.id, async () => { await api(`/admin/control/opportunities/${o.id}/dismiss`, "POST"); await kam.reload(); });
  const search = (e: React.FormEvent) => { e.preventDefault(); void act("search", async () => setResults((await api<{ moments: (Moment & { rank: number })[] }>(`/admin/control/archive?q=${encodeURIComponent(q)}&limit=12`)).moments)); };

  const opps = kam.data?.opportunities ?? [];
  return (
    <>
      <Heading eyebrow="KAM INTELLIGENCE / OPPORTUNITIES" title="What should FaZe drop next?">
        <button onClick={scan} disabled={!!busy}>{busy === "scan" ? "Scanning archive…" : opps.length ? "Re-scan" : "Run KAM scan"}</button>
      </Heading>
      <p className="cr-lede">
        KAM reads FaZe&apos;s history archive (the team timeline, page-cited) against live collector data: card hype, pulls, engagement and catalog gaps. Each recommendation shows exactly where its points came from.
        {kam.data?.scannedAt && <span className="cr-muted"> Last scan {ago(kam.data.scannedAt)}.</span>}
      </p>
      <div className="cr-legend">
        {Object.entries({ anniversary: "Anniversary timing", momentum: "Member momentum", demand: "Collector demand", gap: "Catalog gap", archive: "Archive weight" }).map(([k, v]) => (
          <span key={k}><i style={{ background: SIGNAL_COLORS[k] }} />{v}</span>
        ))}
      </div>
      <div className="cr-kam">
        <div>
          {!opps.length && !kam.loading && (
            <div className="cr-empty"><h2>No scan yet.</h2><p className="cr-muted">Run a KAM scan to rank campaign opportunities from the archive.</p></div>
          )}
          {opps.map((o, i) => (
            <article key={o.id} className={`cr-opp${o.status !== "new" ? " done" : ""}${open === o.id ? " open" : ""}`}>
              <button className="cr-opp-head" onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={open === o.id}>
                <span className="cr-rank">{String(i + 1).padStart(2, "0")}</span>
                <span className="cr-opp-title">
                  <b>{o.moment.title}</b>
                  <small>{dateLabel(o.moment.occurredOn, o.moment.precision)} · {o.moment.members.length ? o.moment.members.join(", ") : "FaZe Clan"}{o.status !== "new" && ` · ${o.status}`}</small>
                </span>
                <span className="cr-opp-score"><b>{o.score.toFixed(0)}</b><small>/100</small></span>
              </button>
              <ScoreBar signals={o.signals} />
              {open === o.id && (
                <div className="cr-opp-body">
                  <p className="cr-reco">{o.recommendation}</p>
                  <table className="cr-evidence">
                    <tbody>
                      {o.signals.map((s) => (
                        <tr key={s.key}>
                          <td><i style={{ background: SIGNAL_COLORS[s.key] }} />{s.label}</td>
                          <td className="num">{s.points.toFixed(1)}<small>/{s.weight}</small></td>
                          <td>{s.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <blockquote>{o.moment.summary}<cite>{o.moment.source}{o.moment.citations.length ? ` · cites ${o.moment.citations.join(", ")}` : ""}</cite></blockquote>
                  {o.status === "new" && (
                    <div className="cr-row">
                      <button onClick={() => createCampaign(o)} disabled={!!busy}>{busy === o.id ? "Drafting…" : "Draft campaign in Moment Studio"}</button>
                      <button className="quiet" onClick={() => dismiss(o)} disabled={!!busy}>Dismiss</button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
        <Panel title="Archive search" note="full-text over 333 moments">
          <form onSubmit={search} className="cr-search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. trickshot, Major, Banks, 1 million" aria-label="Search the archive" />
            <button disabled={busy === "search"}>Search</button>
          </form>
          {results && !results.length && <p className="cr-muted">No moments match.</p>}
          <ul className="cr-results">
            {results?.map((m) => (
              <li key={m.id}>
                <b>{m.title}</b>
                <small>{dateLabel(m.occurredOn, m.precision)} · {m.source.replace(/^.*\(PDF\),\s*/, "PDF ")}</small>
                <p>{m.summary.slice(0, 180)}{m.summary.length > 180 ? "…" : ""}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </>
  );
}
