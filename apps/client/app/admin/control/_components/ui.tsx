"use client";
// FaZe Control Room — Business Operations shell + primitives (no chart dependency; plain SVG).
import Link from "next/link";
import Brand from "../../../brand";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, RARITY_COLORS, SIGNAL_COLORS, STATUS_LABEL, type Campaign, type Signal } from "./lib";
import { PRIMARY_TABS } from "./navigation";

function Nav() {
  const path = usePathname();
  return (
    <nav className="cr-tabs" aria-label="Control Room">
      {PRIMARY_TABS.map((tab) => {
        const on = tab.href === "/admin/control" ? path === tab.href : path.startsWith(tab.href);
        return <Link key={tab.href} href={tab.href} className={`cr-tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>{tab.label}</Link>;
      })}
    </nav>
  );
}

function SignIn({ onDone }: { onDone: (me: { user: { displayName: string; role: string } }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="cr-boot">
      <form
        className="cr-signin"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          setErr("");
          try {
            const r = await api<{ user: { displayName: string; role: string } }>("/auth/admin-login", "POST", d);
            if (r.user.role !== "admin") setErr("This account isn't an administrator.");
            else onDone(r);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Brand label="Control room" />
        <h1>Staff sign-in.</h1>
        <p className="cr-muted">One login for content, campaigns, intelligence and operations.</p>
        <label>Email<input name="email" type="email" required autoComplete="username" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {err && <p className="cr-error" role="alert">{err}</p>}
        <Link href="/" className="cr-muted cr-small">← Back to the fan app</Link>
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<{ user: { displayName: string; role: string } } | null | "none">(null);
  const [down, setDown] = useState("");
  useEffect(() => {
    api("/me").then(setMe).catch((e: Error & { status?: number }) => (e.status === 0 ? setDown(e.message) : setMe("none")));
  }, []);
  if (down)
    return (
      <div className="cr-boot" role="alert">
        <div>
          <p className="eyebrow">FAZE CONTROL ROOM</p>
          <h1>API not responding.</h1>
          <p className="cr-muted">{down}</p>
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  if (me === null) return <div className="cr-boot"><span className="cr-pulse" /> Connecting to the Control Room…</div>;
  if (me === "none" || me.user.role !== "admin") return <SignIn onDone={setMe} />;
  return (
    <>
      <header className="cr-header">
        <Brand label="Control room" />
        <Nav />
        <div className="staff">
          <span className="cr-admin-name">{me.user.displayName}</span>
          <span className="badge live">DEVNET</span>
          <button className="quiet" onClick={async () => { await api("/auth/logout", "POST").catch(() => {}); setMe("none"); }}>Sign out</button>
        </div>
      </header>
      <main className="cr-main">{children}</main>
    </>
  );
}

export function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow.charAt(0) + eyebrow.slice(1).toLowerCase()}</p>
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
export function AreaChart({ points, height = 140, color = "#e4002b", label }: { points: { t: string; n: number }[]; height?: number; color?: string; label: string }) {
  const W = 600, H = height, peak = Math.max(0, ...points.map((p) => p.n)), max = Math.max(1, peak);
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
      <figcaption><span>{points[0]?.t ? new Date(points[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span><span>peak {Number.isInteger(peak) ? peak : peak.toFixed(2)}</span><span>now</span></figcaption>
    </figure>
  );
}

/** Vertical stacked bars: [{t, a, b}]. */
export function StackBars({ rows, a, b, colors = ["#e4002b", "#8a8a8a"], height = 140 }: { rows: Record<string, any>[]; a: string; b: string; colors?: [string, string]; height?: number }) {
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
          <div><i style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "#e4002b" }} /></div>
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
