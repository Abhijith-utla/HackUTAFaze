"use client";
// FaZe Control Room — Business Operations shell + primitives (no chart dependency; plain SVG).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, RARITY_COLORS, SIGNAL_COLORS, STATUS_LABEL, type Campaign, type Signal } from "./lib";

const NAV = [
  { href: "/admin/control", label: "Overview", code: "01" },
  { href: "/admin/control/kam", label: "KAM Intelligence", code: "02" },
  { href: "/admin/control/studio", label: "Moment Studio", code: "03" },
  { href: "/admin/control/campaigns", label: "Campaign Command", code: "04" },
  { href: "/admin/control/audit", label: "Trust & Audit", code: "05" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<{ user: { displayName: string; role: string } } | null | "none">(null);
  useEffect(() => {
    api("/me").then(setMe).catch(() => setMe("none"));
  }, []);
  if (me === null) return <div className="cr-boot"><span className="cr-pulse" /> Connecting to the Control Room…</div>;
  if (me === "none" || me.user.role !== "admin")
    return (
      <div className="cr-boot">
        <div>
          <p className="eyebrow">FAZE CONTROL ROOM</p>
          <h1>Staff sign-in required.</h1>
          <p className="cr-muted">Sign in with an admin account on the staff console, then come back.</p>
          <Link className="cr-btn" href="/admin">Go to staff sign-in</Link>
        </div>
      </div>
    );
  return (
    <>
      <header>
        <div className="brand">F<span>/</span> CONTROL ROOM</div>
        <div className="staff">
          {me.user.displayName}
          <span className="badge">DEMO</span>
          <span className="badge live">DEVNET</span>
        </div>
      </header>
      <div className="shell">
        <aside className="cr-aside">
          <p className="eyebrow">BUSINESS OPERATIONS</p>
          {NAV.map((n) => {
            const on = n.href === "/admin/control" ? path === "/admin/control" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`cr-nav${on ? " on" : ""}`}>
                <span className="cr-code">{n.code}</span>
                {n.label}
              </Link>
            );
          })}
          <p className="eyebrow cr-gap">CONTENT OPERATIONS</p>
          <Link href="/admin" className="cr-nav"><span className="cr-code">↩</span>Sets, cards, packs, moderation</Link>
          <p className="aside-note">
            Demo data · Solana devnet
            <br />
            Every action is server-checked and audit-logged.
          </p>
        </aside>
        <main className="cr-main">{children}</main>
      </div>
    </>
  );
}

export function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children && <div className="cr-actions">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`cr-kpi${accent ? " accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

export function Panel({ title, note, children, className = "" }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cr-panel ${className}`}>
      <div className="cr-panel-head">
        <h2>{title}</h2>
        {note && <span className="cr-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: Campaign["status"] }) {
  return <span className={`cr-status s-${status}`}>{status === "live" && <i className="cr-pulse" />}{STATUS_LABEL[status]}</span>;
}

export function Rarity({ r }: { r: string }) {
  return <span className="cr-rarity" style={{ color: RARITY_COLORS[r], borderColor: RARITY_COLORS[r] }}>{r}</span>;
}

/** Area chart for a time series. */
export function AreaChart({ points, height = 140, color = "#ee2441", label }: { points: { t: string; n: number }[]; height?: number; color?: string; label: string }) {
  const W = 600, H = height, max = Math.max(1, ...points.map((p) => p.n));
  const x = (i: number) => (points.length < 2 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - 8 - (v / max) * (H - 24);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(" ");
  const total = points.reduce((a, p) => a + p.n, 0);
  return (
    <figure className="cr-chart" aria-label={`${label}: ${total} total`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={`g-${label}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.45" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="cr-grid" />)}
        {points.length > 0 && <path d={`${line} L${x(points.length - 1)},${H} L${x(0)},${H} Z`} fill={`url(#g-${label})`} />}
        {points.length > 0 && <path d={line} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption><span>{points[0]?.t ? new Date(points[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span><span>peak {max}</span><span>now</span></figcaption>
    </figure>
  );
}

/** Vertical stacked bars: [{t, a, b}]. */
export function StackBars({ rows, a, b, colors = ["#ee2441", "#22c55e"], height = 140 }: { rows: Record<string, any>[]; a: string; b: string; colors?: [string, string]; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => (r[a] ?? 0) + (r[b] ?? 0)));
  return (
    <div className="cr-bars" style={{ height }}>
      {rows.map((r) => (
        <div key={r.t} className="cr-bar" title={`${r.t}: ${a} ${r[a]}, ${b} ${r[b]}`}>
          <i style={{ height: `${((r[b] ?? 0) / max) * 100}%`, background: colors[1] }} />
          <i style={{ height: `${((r[a] ?? 0) / max) * 100}%`, background: colors[0] }} />
        </div>
      ))}
    </div>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="cr-hbars">
      {rows.map((r) => (
        <div key={r.label} className="cr-hbar">
          <span>{r.label}</span>
          <div><i style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "#ee2441" }} /></div>
          <b>{r.value.toLocaleString("en-US")}</b>
        </div>
      ))}
    </div>
  );
}

/** KAM score as a stacked bar of its explained signals (out of 100). */
export function ScoreBar({ signals }: { signals: Signal[] }) {
  return (
    <div className="cr-score" role="img" aria-label={signals.map((s) => `${s.label} ${s.points}/${s.weight}`).join(", ")}>
      {signals.map((s) => <i key={s.key} style={{ width: `${s.points}%`, background: SIGNAL_COLORS[s.key] }} title={`${s.label}: ${s.points}/${s.weight}`} />)}
    </div>
  );
}

export function Toast({ msg, kind = "ok", onDone }: { msg: string; kind?: "ok" | "err"; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  return <div className={`cr-toast ${kind}`} role={kind === "err" ? "alert" : "status"}>{msg}</div>;
}
