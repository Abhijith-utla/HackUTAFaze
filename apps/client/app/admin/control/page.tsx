"use client";
import Link from "next/link";
import { AreaChart, Heading, HBars, Kpi, Panel, StackBars } from "./_components/ui";
import { api, compact, n, useLoad } from "./_components/lib";

type Overview = {
  kpis: Record<string, number>;
  health: { api: string; dbMs: number; jobsQueued: number; jobsFailed: number; workerLastEventSecondsAgo: number | null; workerLastJobSecondsAgo: number | null; cluster: string };
  series: { pullsByHour: { t: string; n: number }[]; coinsByDay: { t: string; spent: number; purchased: number }[] };
  topMembers: { member: string; pulls: number }[];
};

const since = (s: number | null) => (s === null ? "never" : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);

export default function OverviewPage() {
  const { data, error } = useLoad(() => api<Overview>("/admin/control/overview"), [], 5000);
  const k = data?.kpis;
  const workerOk = data && data.health.workerLastEventSecondsAgo !== null && data.health.workerLastEventSecondsAgo < 120;
  return (
    <>
      <Heading eyebrow="FAZE CONTROL ROOM / OVERVIEW" title="The business, live.">
        <span className="cr-live"><i className="cr-pulse" /> Refreshing every 5s</span>
        <Link className="cr-btn" href="/admin/control/scout">Discover videos</Link>
      </Heading>
      {error && <p className="cr-error" role="alert">{error}</p>}
      <div className="cr-kpis">
        <Kpi accent label="Collectors" value={k ? n(k.collectors) : "…"} sub={k ? `+${n(k.newCollectors24h)} in 24h · ${n(k.demoCollectors)} demo` : ""} />
        <Kpi label="Packs opened" value={k ? compact(k.packsOpened) : "…"} sub={k ? `${n(k.packs24h)} in the last 24h` : ""} />
        <Kpi label="Coins spent on packs" value={k ? compact(k.coinsSpent) : "…"} sub={k ? `${compact(k.coinsPurchased)} coins bought` : ""} />
        <Kpi label="Devnet SOL received" value={k ? n(k.solReceived, 2) : "…"} sub={k ? `${n(k.purchasesPaid)} verified payments · test funds` : ""} />
        <Kpi label="Trades completed" value={k ? n(k.tradesAccepted) : "…"} sub={k ? `${n(k.tradesOpen)} open offers` : ""} />
        <Kpi label="Live campaigns" value={k ? n(k.campaignsLive) : "…"} sub={<Link href="/admin/control/campaigns">Campaign Command →</Link>} />
        <Kpi label="Awaiting approval" value={k ? n(k.approvalsPending) : "…"} sub={<Link href="/admin/control/studio">Moment Studio →</Link>} />
        <Kpi label="Moderation queue" value={k ? n(k.moderationPending) : "…"} sub={<Link href="/admin/control/trust">Review in Trust & Ops →</Link>} />
      </div>
      <div className="cr-grid2">
        <Panel title="Pack opens, last 24 hours" note="per hour · from pulls">
          {data && <AreaChart label="pulls" points={data.series.pullsByHour} />}
        </Panel>
        <Panel title="Coin economy, 14 days" note={<><i className="cr-key" style={{ background: "#ee2441" }} />spent on packs <i className="cr-key" style={{ background: "#22c55e" }} />bought with devnet SOL</>}>
          {data && <StackBars rows={data.series.coinsByDay} a="spent" b="purchased" />}
        </Panel>
      </div>
      <div className="cr-grid2">
        <Panel title="Most-pulled members, 7 days" note="cards pulled">
          {data && (data.topMembers.length ? <HBars rows={data.topMembers.map((m) => ({ label: m.member, value: m.pulls }))} /> : <p className="cr-muted">No pulls yet. Open a pack in the fan app or simulate a drop.</p>)}
        </Panel>
        <Panel title="System health">
          {data && (
            <ul className="cr-health">
              <li className="ok"><b>API</b><span>online</span></li>
              <li className={data.health.dbMs < 50 ? "ok" : "warn"}><b>Database</b><span>{data.health.dbMs} ms round-trip</span></li>
              <li className={workerOk ? "ok" : "warn"}><b>Worker</b><span>last engagement event {since(data.health.workerLastEventSecondsAgo)}</span></li>
              <li className={data.health.jobsFailed ? "warn" : "ok"}><b>Job queue</b><span>{data.health.jobsQueued} queued · {data.health.jobsFailed} failed</span></li>
              <li className="ok"><b>Payments</b><span>Solana {data.health.cluster} · server-verified</span></li>
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
