"use client";
// Control Room home: minimal, high-impact. One sentence, one next move, one live drop, three numbers,
// and only the things that need a human. Everything else is in ⌘K / the sidebar.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Toast } from "./_components/ui";
import { api, compact, n, SIGNAL_COLORS, useLoad, type Campaign, type Opportunity } from "./_components/lib";

type Overview = {
  kpis: { collectors: number; newCollectors24h: number; packs24h: number; packsOpened: number; solReceived: number; purchasesPaid: number; campaignsLive: number; approvalsPending: number; moderationPending: number; tradesOpen: number };
  health: { dbMs: number; jobsFailed: number; workerLastEventSecondsAgo: number | null };
  series: { pullsByHour: { t: string; n: number }[] };
};
type Metrics = { launched: boolean; pulls: number; collectors: number; coinsSpent: number; pullsByMinute: { t: string; n: number }[] };

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Tiny inline sparkline, no axes: shape only. */
function Spark({ points, color = "#ee2441", height = 44 }: { points: number[]; color?: string; height?: number }) {
  const W = 220, H = height, max = Math.max(1, ...points);
  if (points.length < 2) return <svg className="hm-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, H - 3 - (v / max) * (H - 8)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="hm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Score ring for KAM's top recommendation. */
function Ring({ score }: { score: number }) {
  const r = 34, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg className="hm-ring" viewBox="0 0 84 84" role="img" aria-label={`KAM score ${Math.round(score)} out of 100`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="#26262e" strokeWidth="6" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="#ee2441" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle">{Math.round(score)}</text>
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const ov = useLoad(() => api<Overview>("/admin/control/overview"), [], 5000);
  const kam = useLoad(() => api<{ opportunities: Opportunity[]; scannedAt: string | null }>("/admin/control/kam"), []);
  const camps = useLoad(() => api<{ campaigns: Campaign[] }>("/admin/control/campaigns"), [], 5000);
  const live = camps.data?.campaigns.find((c) => c.status === "live") ?? null;
  const metrics = useLoad(() => (live ? api<Metrics>(`/admin/control/campaigns/${live.id}/metrics`) : Promise.resolve(null)), [live?.id], live ? 3000 : 0);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);

  const k = ov.data?.kpis;
  const next = kam.data?.opportunities.find((o) => o.status === "new") ?? null;
  const ready = camps.data?.campaigns.find((c) => c.status === "approved") ?? null;

  const needs = [
    k && k.approvalsPending > 0 && { n: k.approvalsPending, label: k.approvalsPending === 1 ? "drop waiting for approval" : "drops waiting for approval", href: "/admin/control/studio" },
    ready && { n: 1, label: `approved drop ready to launch: ${ready.name}`, href: `/admin/control/campaigns/${ready.id}` },
    k && k.moderationPending > 0 && { n: k.moderationPending, label: "submissions to moderate", href: "/admin/control/trust" },
    ov.data && ov.data.health.jobsFailed > 0 && { n: ov.data.health.jobsFailed, label: "background jobs failed", href: "/admin/control/trust" },
    ov.data && (ov.data.health.workerLastEventSecondsAgo === null || ov.data.health.workerLastEventSecondsAgo > 300) && { n: "!", label: "worker hasn’t reported recently", href: "/admin/control/trust" },
  ].filter(Boolean) as { n: number | string; label: string; href: string }[];

  async function draft(o: Opportunity) {
    setBusy("draft");
    try {
      const r = await api<{ campaign: { id: string } }>("/admin/control/campaigns", "POST", { opportunityId: o.id });
      router.push(`/admin/control/campaigns/${r.campaign.id}`);
    } catch (e) {
      setToast({ msg: (e as Error).message, kind: "err" });
      setBusy("");
    }
  }
  async function scan() {
    setBusy("scan");
    try {
      await api("/admin/control/kam/scan", "POST");
      await kam.reload();
    } catch (e) {
      setToast({ msg: (e as Error).message, kind: "err" });
    } finally {
      setBusy("");
    }
  }

  const headline = k
    ? `${n(k.packs24h)} ${k.packs24h === 1 ? "pack" : "packs"} opened today. ${k.campaignsLive ? `${k.campaignsLive} ${k.campaignsLive === 1 ? "drop" : "drops"} live.` : "No drop live."}`
    : "…";

  return (
    <div className="hm">
      <section className="hm-top">
        <p className="hm-eyebrow">
          {greeting()} · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          <span className="hm-pulse"><i className="cr-pulse" /> live</span>
        </p>
        <h1 className="hm-headline">{headline}</h1>
        <p className="hm-sub">{k ? <>{n(k.collectors)} collectors · {n(k.newCollectors24h)} joined today · {n(k.solReceived, 2)} devnet SOL received</> : " "}</p>
        <p className="hm-hint">Press <kbd>⌘</kbd><kbd>K</kbd> to jump anywhere.</p>
      </section>

      <section className="hm-pair">
        <article className="hm-card hm-next">
          <p className="hm-label">Next best move</p>
          {next ? (
            <>
              <div className="hm-next-body">
                <Ring score={next.score} />
                <div>
                  <h2>{next.moment.title}</h2>
                  <p className="hm-why">{([...next.signals].sort((a, b) => b.points - a.points)[0]?.detail ?? "").split("; FaZe Clan: A Timeline")[0]}</p>
                  <div className="hm-chips">
                    {next.signals.filter((s) => s.points > 0).map((s) => <span key={s.key}><i style={{ background: SIGNAL_COLORS[s.key] }} />{s.label}</span>)}
                  </div>
                </div>
              </div>
              <div className="hm-actions">
                <button onClick={() => draft(next)} disabled={!!busy}>{busy === "draft" ? "Drafting…" : "Draft this drop"}</button>
                <Link href="/admin/control/kam" className="hm-link">See all ideas →</Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="hm-empty">No recommendation yet.</h2>
              <p className="hm-why">KAM reads FaZe’s history against live collector data and picks the moment worth dropping.</p>
              <div className="hm-actions"><button onClick={scan} disabled={!!busy}>{busy === "scan" ? "Scanning…" : "Find the next drop"}</button></div>
            </>
          )}
        </article>

        <article className={`hm-card hm-live${live ? " on" : ""}`}>
          <p className="hm-label">{live ? <><i className="cr-pulse" /> Live drop</> : "Live drop"}</p>
          {live ? (
            <>
              <h2>{live.name}</h2>
              <div className="hm-big"><b>{metrics.data?.launched ? n(metrics.data.pulls) : "…"}</b><span>packs opened</span></div>
              <Spark points={(metrics.data?.pullsByMinute ?? []).map((p) => p.n)} color="#22c55e" />
              <p className="hm-why">{metrics.data?.launched ? `${n(metrics.data.collectors)} collectors · ${compact(metrics.data.coinsSpent)} coins` : " "}</p>
              <div className="hm-actions"><Link href={`/admin/control/campaigns/${live.id}`} className="hm-btn">Open drop</Link></div>
            </>
          ) : (
            <>
              <h2 className="hm-empty">Nothing live right now.</h2>
              <p className="hm-why">{ready ? `“${ready.name}” is approved and ready.` : "Approved drops appear here the moment they launch."}</p>
              <div className="hm-actions">
                {ready ? <Link href={`/admin/control/campaigns/${ready.id}`} className="hm-btn">Launch it</Link> : <Link href="/admin/control/campaigns" className="hm-link">Campaign Command →</Link>}
              </div>
            </>
          )}
        </article>
      </section>

      <section className="hm-three">
        <div className="hm-stat">
          <span>Collectors</span>
          <b>{k ? compact(k.collectors) : "…"}</b>
          <em>+{k ? n(k.newCollectors24h) : "…"} today</em>
        </div>
        <div className="hm-stat">
          <span>Packs opened · 24h</span>
          <b>{k ? compact(k.packs24h) : "…"}</b>
          <Spark points={(ov.data?.series.pullsByHour ?? []).map((p) => p.n)} />
        </div>
        <div className="hm-stat">
          <span>Devnet SOL received</span>
          <b>{k ? n(k.solReceived, 2) : "…"}</b>
          <em>{k ? `${n(k.purchasesPaid)} verified payments` : ""}</em>
        </div>
      </section>

      <section className="hm-needs">
        <p className="hm-label">Needs you</p>
        {ov.data && camps.data && (needs.length ? (
          <ul>
            {needs.map((x) => (
              <li key={x.label}>
                <Link href={x.href}><b>{x.n}</b><span>{x.label}</span><i aria-hidden="true">→</i></Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hm-clear">All clear. Nothing needs a human right now.</p>
        ))}
      </section>

      <p className="hm-foot"><Link href="/admin/control/analytics">Full analytics</Link> · <Link href="/admin/control/fans">Fans</Link> · <Link href="/admin/control/revenue">Revenue</Link> · <Link href="/admin/control/trust">Trust</Link></p>
      {(ov.error || kam.error) && <p className="cr-error" role="alert">{ov.error || kam.error}</p>}
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}
