"use client";
import { Heading } from "../_components/ui";
import { api, useLoad } from "../_components/lib";

type Entry = { id: number; actor: string | null; action: string; entity: string; entityId: string | null; detail: Record<string, unknown>; createdAt: string };

export default function AuditPage() {
  const { data, error } = useLoad(() => api<{ entries: Entry[] }>("/admin/control/audit?limit=100"), [], 10000);
  return (
    <>
      <Heading eyebrow="TRUST & AUDIT / LOG" title="Every decision, on the record." />
      <p className="cr-lede">An append-only log of Control Room actions: scans, drafts, edits, approvals with rights confirmations, launches, simulations and endings.</p>
      {error && <p className="cr-error" role="alert">{error}</p>}
      <div className="cr-table-wrap">
        <table className="cr-table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actor ?? "system"}</td>
                <td><code>{e.action}</code></td>
                <td className="cr-detail">{Object.entries(e.detail).map(([k, v]) => <span key={k}><b>{k}</b> {typeof v === "object" ? JSON.stringify(v) : String(v)}</span>)}</td>
              </tr>
            ))}
            {data && !data.entries.length && <tr><td colSpan={4} className="cr-muted">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
