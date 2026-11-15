"use client";
import Link from "next/link";
import { StatusBadge } from "./ui";
import { ago, api, n, useLoad, type Campaign } from "./lib";

export function CampaignList({ statuses, empty, poll = 0 }: { statuses: Campaign["status"][]; empty: React.ReactNode; poll?: number }) {
  const { data, error } = useLoad(() => api<{ campaigns: Campaign[] }>("/admin/control/campaigns"), [], poll);
  const rows = (data?.campaigns ?? []).filter((c) => statuses.includes(c.status));
  if (error) return <p className="cr-error" role="alert">{error}</p>;
  if (data && !rows.length) return <div className="cr-empty">{empty}</div>;
  return (
    <div className="cr-table-wrap">
      <table className="cr-table">
        <thead>
          <tr><th>Campaign</th><th>Status</th><th className="num">Pack price</th><th className="num">Pack opens</th><th>Updated</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/admin/control/campaigns/${c.id}`}><b>{c.name}</b></Link><small>{c.generator === "template" ? "Template writer" : c.generator}</small></td>
              <td><StatusBadge status={c.status} /></td>
              <td className="num">{n(c.packPriceCoins)} coins</td>
              <td className="num">{c.packId ? n(c.pulls ?? 0) : "—"}</td>
              <td>{ago(c.endedAt ?? c.launchedAt ?? c.reviewedAt ?? c.submittedAt ?? c.createdAt)}</td>
              <td><Link className="cr-open" href={`/admin/control/campaigns/${c.id}`}>Open →</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
