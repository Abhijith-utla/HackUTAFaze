"use client";
import Link from "next/link";
import { useState } from "react";
import { Heading, Kpi, Panel, StatusBadge, Toast } from "../_components/ui";
import { ago, api, n, useLoad, type Campaign } from "../_components/lib";

type Ops = {
  health: { api: string; dbMs: number; lastEngagementEvent: string | null; lastJobFinished: string | null; cluster: string };
  jobs: { byKindStatus: { kind: string; status: string; n: number }[]; recent: { id: string; kind: string; status: string; error: string | null; createdAt: string; updatedAt: string }[] };
  moderation: { id: string; kind: string; author: string; summary: string; autoFlags: string[]; createdAt: string }[];
  rights: { id: string; name: string; status: Campaign["status"]; rightsConfirmed: boolean; rightsNote: string; reviewNote: string; reviewer: string | null; reviewedAt: string | null; launchedAt: string | null; source: string | null }[];
  migrations: { name: string; appliedAt: string }[];
  users: { role: string; demo: boolean; count: number }[];
};

const fresh = (iso: string | null, secs: number) => !!iso && Date.now() - +new Date(iso) < secs * 1000;

export default function TrustPage() {
  const ops = useLoad(() => api<Ops>("/admin/control/ops"), [], 10000);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const o = ops.data;
  const failed = o?.jobs.byKindStatus.filter((j) => j.status === "failed").reduce((t, j) => t + j.n, 0) ?? 0;
  const queued = o?.jobs.byKindStatus.filter((j) => j.status === "queued").reduce((t, j) => t + j.n, 0) ?? 0;
  const workerOk = o ? fresh(o.health.lastEngagementEvent, 120) || fresh(o.health.lastJobFinished, 300) : false;
  const decide = (id: string, decision: "approve" | "reject") =>
    void (async () => {
      setBusy(id);
      try {
        await api(`/admin/moderation/${id}`, "POST", { decision });
        setToast({ msg: decision === "approve" ? "Approved and now visible to fans." : "Rejected; it stays hidden." });
        await ops.reload();
      } catch (e) {
        setToast({ msg: (e as Error).message, kind: "err" });
      } finally {
        setBusy("");
      }
    })();

  return (
    <>
      <Heading eyebrow="TRUST / OPERATIONS" title="Safe to ship, and still running.">
        <Link className="cr-btn" href="/admin/control/audit">Full audit log →</Link>
      </Heading>
      {ops.error && <p className="cr-error" role="alert">{ops.error}</p>}
      <div className="cr-kpis">
        <Kpi accent label="Moderation queue" value={o ? n(o.moderation.length) : "…"} sub="nothing pending is shown to fans" />
        <Kpi label="Rights confirmed" value={o ? `${o.rights.filter((r) => r.rightsConfirmed).length}/${o.rights.filter((r) => r.status !== "rejected").length}` : "…"} sub="approved, live and ended drops" />
        <Kpi label="Jobs queued / failed" value={o ? `${n(queued)} / ${n(failed)}` : "…"} sub={o ? `last finished ${ago(o.health.lastJobFinished)}` : ""} />
        <Kpi label="Database" value={o ? `${o.health.dbMs} ms` : "…"} sub="round-trip from the API" />
      </div>
      <div className="cr-grid2">
        <Panel title="System status">
          {o && (
            <ul className="cr-health">
              <li className="ok"><b>API</b><span>online</span></li>
              <li className={o.health.dbMs < 50 ? "ok" : "warn"}><b>Database</b><span>{o.health.dbMs} ms</span></li>
              <li className={workerOk ? "ok" : "warn"}><b>Worker</b><span>{workerOk ? "heartbeat OK" : "no recent heartbeat"} · last event {ago(o.health.lastEngagementEvent)}</span></li>
              <li className={failed ? "warn" : "ok"}><b>Job queue</b><span>{queued} queued · {failed} failed</span></li>
              <li className="ok"><b>Payments</b><span>Solana {o.health.cluster} · server-verified</span></li>
              <li className="ok"><b>Accounts</b><span>{o.users.map((u) => `${u.count} ${u.role}${u.demo ? " (demo)" : ""}`).join(" · ")}</span></li>
            </ul>
          )}
        </Panel>
        <Panel title="Moderation queue" note="display names, trade messages, fan art">
          {o && !o.moderation.length && <p className="cr-muted">Queue clear.</p>}
          <ul className="cr-queue">
            {o?.moderation.map((m) => (
              <li key={m.id}>
                <div>
                  <b>{m.summary}</b>
                  <small className="cr-muted">{m.author} · {ago(m.createdAt)}{m.autoFlags.length ? "" : " · no auto-flags"}</small>
                  {m.autoFlags.length > 0 && <small className="cr-warn">Flags: {m.autoFlags.join(", ")}</small>}
                </div>
                <div className="cr-row">
                  <button className="cr-small" disabled={busy === m.id} onClick={() => decide(m.id, "approve")}>Approve</button>
                  <button className="quiet cr-small" disabled={busy === m.id} onClick={() => decide(m.id, "reject")}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Rights register" note="every drop's licensing confirmation, from the approval step">
        <div className="cr-table-wrap">
          <table className="cr-table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Rights</th><th>Note</th><th>Source</th><th>Reviewer</th></tr></thead>
            <tbody>
              {o?.rights.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/admin/control/campaigns/${r.id}`}><b>{r.name}</b></Link></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.rightsConfirmed ? <span className="badge live">confirmed</span> : <span className="badge">not confirmed</span>}</td>
                  <td>{r.rightsNote || r.reviewNote || "—"}</td>
                  <td><small>{r.source ?? "—"}</small></td>
                  <td>{r.reviewer ?? "—"}<small>{ago(r.reviewedAt)}</small></td>
                </tr>
              ))}
              {o && !o.rights.length && <tr><td colSpan={6} className="cr-muted">No reviewed campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="cr-grid2">
        <Panel title="Recent background jobs" note="spikes, publishing, moderation">
          <div className="cr-table-wrap">
            <table className="cr-table">
              <thead><tr><th>Kind</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {o?.jobs.recent.map((j) => (
                  <tr key={j.id}><td><code>{j.kind}</code></td><td>{j.status}{j.error && <small className="cr-warn">{j.error.slice(0, 120)}</small>}</td><td>{ago(j.updatedAt)}</td></tr>
                ))}
                {o && !o.jobs.recent.length && <tr><td colSpan={3} className="cr-muted">No jobs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Schema" note="applied migrations">
          <ul className="cr-migrations">
            {o?.migrations.map((m) => <li key={m.name}><code>{m.name}</code><span className="cr-muted">{ago(m.appliedAt)}</span></li>)}
          </ul>
        </Panel>
      </div>
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </>
  );
}
