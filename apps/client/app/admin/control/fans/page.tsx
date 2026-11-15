"use client";
import { Heading, HBars, Kpi, Panel } from "../_components/ui";
import { ago, api, n, useLoad } from "../_components/lib";

type Fans = {
  funnel: { signedUp: number; openedPack: number; boughtCoins: number; traded: number };
  cohorts: { day: string; ageDays: number; size: number; activatedD0: number; retainedD1: number | null; retainedD3: number | null; retainedD7: number | null }[];
  segments: { new: number; active: number; dormant: number; neverActivated: number; active24h: number };
  spend: { spenders: number; totalCoins: number; topDecileShare: number };
  creatorDependence: { members: { member: string; owned: number; share: number }[]; hhi: number; topMemberShare: number; risk: "high" | "moderate" | "diversified"; note: string };
  topCollectors: { id: string; name: string; demo: boolean; cards: number; score: number; coinsSpent: number; lastActive: string | null }[];
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function Retention({ v, size }: { v: number | null; size: number }) {
  if (v === null) return <td className="num cr-muted" title="Cohort too young to measure">·</td>;
  const r = size ? v / size : 0;
  return <td className="num cr-heat" style={{ background: `rgba(238,36,65,${0.08 + r * 0.6})` }}>{pct(v, size)}</td>;
}

export default function FansPage() {
  const { data: f, error } = useLoad(() => api<Fans>("/admin/control/fans"), [], 15000);
  const steps = f ? [
    { label: "Signed up", v: f.funnel.signedUp },
    { label: "Opened a pack", v: f.funnel.openedPack },
    { label: "Paid with SOL (coins or packs, devnet)", v: f.funnel.boughtCoins },
    { label: "Completed a trade", v: f.funnel.traded },
  ] : [];
  const risk = f?.creatorDependence.risk;
  return (
    <>
      <Heading eyebrow="INTELLIGENCE / FANS" title="Who collects, who stays." />
      <p className="cr-lede">Activation, retention and concentration, computed from real pack opens, trades and server-verified purchases. Admin accounts are excluded; demo collectors are counted and labelled.</p>
      {error && <p className="cr-error" role="alert">{error}</p>}
      <div className="cr-kpis">
        <Kpi accent label="Active in 24h" value={f ? n(f.segments.active24h) : "…"} sub={f ? `of ${n(f.funnel.signedUp)} collectors` : ""} />
        <Kpi label="New (7 days)" value={f ? n(f.segments.new) : "…"} />
        <Kpi label="Active (7 days)" value={f ? n(f.segments.active) : "…"} sub="older than 7d, active since" />
        <Kpi label="Dormant" value={f ? n(f.segments.dormant) : "…"} sub="no activity in 7 days" />
        <Kpi label="Never activated" value={f ? n(f.segments.neverActivated) : "…"} sub="signed up, never opened or traded" />
        <Kpi label="Top 10% of spenders" value={f ? pct(f.spend.topDecileShare * 100, 100) : "…"} sub={f ? `of ${n(f.spend.totalCoins)} coins spent on packs` : ""} />
      </div>
      <div className="cr-grid2">
        <Panel title="Activation funnel" note="share of all collectors">
          <ol className="cr-funnel">
            {steps.map((s, i) => (
              <li key={s.label}>
                <div className="cr-funnel-bar" style={{ width: `${f && f.funnel.signedUp ? Math.max(2, (s.v / f.funnel.signedUp) * 100) : 0}%` }} />
                <div className="cr-funnel-text">
                  <span>{s.label}</span>
                  <em>{i === 0 ? "100% of collectors" : pct(s.v, f!.funnel.signedUp)}{i > 0 && steps[i - 1].v ? ` · ${pct(s.v, steps[i - 1].v)} of previous step` : ""}</em>
                </div>
                <b>{n(s.v)}</b>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Creator dependence" note={f ? <span className={risk === "high" ? "cr-warn" : ""}>HHI {f.creatorDependence.hhi} · {risk}</span> : ""}>
          {f && (f.creatorDependence.members.length ? (
            <>
              <HBars rows={f.creatorDependence.members.slice(0, 8).map((m) => ({ label: m.member, value: m.owned }))} />
              <p className="cr-muted cr-small">Top member holds {pct(f.creatorDependence.topMemberShare * 100, 100)} of all cards fans own. {f.creatorDependence.note}</p>
            </>
          ) : <p className="cr-muted">No cards owned by fans yet.</p>)}
        </Panel>
      </div>
      <Panel title="Daily signup cohorts, last 14 days" note="retention = any pack open, trade or purchase on or after day N">
        <div className="cr-table-wrap">
          <table className="cr-table cr-cohorts">
            <thead><tr><th>Cohort</th><th className="num">Size</th><th className="num">Activated day 0</th><th className="num">D1</th><th className="num">D3</th><th className="num">D7</th></tr></thead>
            <tbody>
              {f?.cohorts.map((c) => (
                <tr key={c.day}>
                  <td>{new Date(c.day + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}</td>
                  <td className="num">{n(c.size)}</td>
                  <td className="num">{pct(c.activatedD0, c.size)}</td>
                  <Retention v={c.retainedD1} size={c.size} />
                  <Retention v={c.retainedD3} size={c.size} />
                  <Retention v={c.retainedD7} size={c.size} />
                </tr>
              ))}
              {f && !f.cohorts.length && <tr><td colSpan={6} className="cr-muted">No signups in the last 14 days.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="cr-muted cr-small">“·” = cohort too young to measure yet.</p>
      </Panel>
      <Panel title="Top collectors" note="score = rarity-weighted cards owned (leaderboard formula)">
        <div className="cr-table-wrap">
          <table className="cr-table">
            <thead><tr><th>#</th><th>Collector</th><th className="num">Score</th><th className="num">Cards</th><th className="num">Coins on packs</th><th>Last active</th></tr></thead>
            <tbody>
              {f?.topCollectors.map((t, i) => (
                <tr key={t.id}>
                  <td className="num">{i + 1}</td>
                  <td>{t.name}{t.demo && <span className="badge cr-inline-badge">demo</span>}</td>
                  <td className="num">{n(t.score)}</td>
                  <td className="num">{n(t.cards)}</td>
                  <td className="num">{n(t.coinsSpent)}</td>
                  <td>{ago(t.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
