// KAM: ranks campaign opportunities from the archive + live app data. Every point is explainable:
// each signal records its raw value, weight and the evidence behind it.
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { toMoment } from "./archive.js";

export type Signal = { key: string; label: string; weight: number; value: number; points: number; detail: string };

const W = { anniversary: 30, momentum: 25, demand: 20, gap: 10, archive: 15 };

/** Days from `now` until the next anniversary of `d` (0 = today). */
export function daysToAnniversary(d: Date, now: Date): { days: number; years: number; on: Date } {
  const y = now.getUTCFullYear();
  let next = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const today = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
  if (next < today) next = new Date(Date.UTC(y + 1, d.getUTCMonth(), d.getUTCDate()));
  return { days: Math.round((+next - +today) / 86_400_000), years: next.getUTCFullYear() - d.getUTCFullYear(), on: next };
}

/** Parses the archive's own view counts ("5.44M views", "475,099 lifetime views"). */
export function viewsIn(text: string): number {
  let best = 0;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([KM])?\s+(?:lifetime\s+)?views/gi)) {
    const n = parseFloat(m[1].replace(/,/g, "")) * (m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1);
    best = Math.max(best, n);
  }
  return best;
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MemberStats = { cards: number; hype: number; pulls7d: number; owners: number; eng24: number; engPrev24: number };

async function memberStats(db: Db): Promise<{ by: Map<string, MemberStats>; totalPulls7d: number }> {
  const cards = await db.query<{ member: string; cards: string; hype: string }>(
    `SELECT c.faze_member AS member, count(*)::text AS cards, coalesce(avg(s.hype),0)::text AS hype
     FROM cards c LEFT JOIN card_stats s ON s.card_id = c.id GROUP BY c.faze_member`,
  );
  const pulls = await db.query<{ member: string; n: string; owners: string }>(
    `SELECT c.faze_member AS member, count(*)::text AS n, count(DISTINCT p.user_id)::text AS owners
     FROM pulls p JOIN LATERAL unnest(p.card_instance_ids) AS iid ON true
     JOIN card_instances ci ON ci.id = iid JOIN cards c ON c.id = ci.card_id
     WHERE p.created_at > now() - interval '7 days' GROUP BY c.faze_member`,
  );
  const eng = await db.query<{ member: string; cur: string; prev: string }>(
    `SELECT faze_member AS member,
            coalesce(sum(value) FILTER (WHERE created_at > now() - interval '24 hours'),0)::text AS cur,
            coalesce(sum(value) FILTER (WHERE created_at <= now() - interval '24 hours' AND created_at > now() - interval '48 hours'),0)::text AS prev
     FROM engagement_events GROUP BY faze_member`,
  );
  const by = new Map<string, MemberStats>();
  const get = (raw: string) => {
    const k = raw.replace(/^FaZe\s+/i, "").trim().toLowerCase();
    if (!by.has(k)) by.set(k, { cards: 0, hype: 0, pulls7d: 0, owners: 0, eng24: 0, engPrev24: 0 });
    return by.get(k)!;
  };
  for (const r of cards.rows) Object.assign(get(r.member), { cards: Number(r.cards), hype: Number(r.hype) });
  for (const r of pulls.rows) Object.assign(get(r.member), { pulls7d: Number(r.n), owners: Number(r.owners) });
  for (const r of eng.rows) Object.assign(get(r.member), { eng24: Number(r.cur), engPrev24: Number(r.prev) });
  const totalPulls7d = pulls.rows.reduce((a, r) => a + Number(r.n), 0);
  return { by, totalPulls7d };
}

export function scoreMoment(m: ReturnType<typeof toMoment>, stats: Map<string, MemberStats>, totalPulls7d: number, now: Date) {
  const signals: Signal[] = [];
  const push = (key: keyof typeof W, label: string, value: number, detail: string) =>
    signals.push({ key, label, weight: W[key], value: Math.max(0, Math.min(1, value)), points: Math.round(W[key] * Math.max(0, Math.min(1, value)) * 10) / 10, detail });

  // 1. Anniversary timing (only meaningful for day/month-precise moments)
  if (m.precision === "year") push("anniversary", "Anniversary timing", 0, "Year-only date in the archive; no anniversary window");
  else {
    const a = daysToAnniversary(new Date(m.occurredOn + "T00:00:00Z"), now);
    const milestone = a.years % 5 === 0 && a.years > 0;
    const v = Math.max(0, 1 - a.days / 45) * (milestone ? 1 : 0.8);
    const when = m.precision === "day" ? `${MONTHS[a.on.getUTCMonth()]} ${a.on.getUTCDate()}` : MONTHS[a.on.getUTCMonth()];
    push("anniversary", "Anniversary timing", v, a.days <= 45 ? `${a.years}-year anniversary in ${a.days} day${a.days === 1 ? "" : "s"} (${when})${milestone ? ", a milestone year" : ""}` : `Next anniversary in ${a.days} days (${when})`);
  }

  const ms = m.members.map((x) => ({ name: x, s: stats.get(x.toLowerCase()) })).filter((x) => x.s);
  // 2. Member momentum: live card hype + engagement trend for featured members
  if (!ms.length) push("momentum", "Member momentum", 0, m.members.length ? `No live cards or engagement yet for ${m.members.join(", ")}` : "No FaZe member named in this moment");
  else {
    const hype = Math.max(...ms.map((x) => x.s!.hype));
    const top = ms.reduce((a, b) => (b.s!.hype > a.s!.hype ? b : a));
    const trend = ms.reduce((a, x) => a + x.s!.eng24, 0) / Math.max(1, ms.reduce((a, x) => a + x.s!.engPrev24, 0));
    const v = 0.7 * (hype / 100) + 0.3 * Math.min(1, trend / 2);
    push("momentum", "Member momentum", v, `${top.name}: avg card hype ${hype.toFixed(0)}/100; engagement ${trend >= 1 ? "up" : "down"} ${Math.abs((trend - 1) * 100).toFixed(0)}% vs prior 24h`);
  }

  // 3. Collector demand: share of last-7-day pulls that featured these members
  const pulls = ms.reduce((a, x) => a + x.s!.pulls7d, 0), owners = ms.reduce((a, x) => a + x.s!.owners, 0);
  push("demand", "Collector demand", totalPulls7d ? Math.min(1, (pulls / totalPulls7d) * 3) : 0, totalPulls7d ? `${pulls} of ${totalPulls7d} cards pulled in 7 days feature them (${owners} collectors)` : "No pulls in the last 7 days yet");

  // 4. Catalog gap: fewer existing cards for these members → fresher drop
  const existing = ms.reduce((a, x) => a + x.s!.cards, 0);
  push("gap", "Catalog gap", m.members.length ? 1 / (1 + existing / 6) : 0.2, m.members.length ? `${existing} existing card${existing === 1 ? "" : "s"} for ${m.members.join(", ")}` : "Org-wide moment");

  // 5. Archive weight: the moment's own reach + type
  const views = viewsIn(m.summary);
  const typeBoost = m.tags.includes("milestone") || m.tags.includes("esports") ? 0.25 : 0;
  push("archive", "Archive weight", Math.min(1, (views ? Math.log10(views) / 7.1 : 0.35) + typeBoost), `${views ? `${fmt(views)} views on record` : "No view count on record"}${typeBoost ? `; ${m.tags.filter((t) => t === "milestone" || t === "esports").join(" + ")} moment` : ""}; ${m.source}`);

  const score = Math.round(signals.reduce((a, s) => a + s.points, 0) * 10) / 10;
  const lead = [...signals].sort((a, b) => b.points - a.points)[0];
  const who = m.members.length ? m.members.slice(0, 3).join(", ") : "FaZe Clan";
  const recommendation = `Drop a 5-card "${m.title}" moment set featuring ${who}. Strongest signal: ${lead.label.toLowerCase()} (${lead.detail}).`;
  return { score, signals, recommendation };
}

/** Scores every archive moment, stores the top `keep` as a new scan, returns them ranked. */
export async function runScan(db: Db, now = new Date(), keep = 12) {
  const { by, totalPulls7d } = await memberStats(db);
  const moments = (await db.query("SELECT * FROM archive_moments")).rows.map(toMoment);
  const used = new Set((await db.query<{ moment_id: string }>("SELECT moment_id FROM campaigns WHERE moment_id IS NOT NULL")).rows.map((r) => r.moment_id));
  const ranked = moments
    .filter((m) => !used.has(m.id))
    .map((m) => ({ moment: m, ...scoreMoment(m, by, totalPulls7d, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, keep);
  const scanId = randomUUID();
  const out = [];
  for (const r of ranked) {
    const ins = await db.query(
      "INSERT INTO opportunities (moment_id, score, signals, recommendation, scan_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, status, created_at",
      [r.moment.id, r.score, JSON.stringify(r.signals), r.recommendation, scanId],
    );
    out.push({ id: ins.rows[0].id as string, status: ins.rows[0].status as string, score: r.score, signals: r.signals, recommendation: r.recommendation, moment: r.moment, scanId, createdAt: ins.rows[0].created_at });
  }
  return { scanId, scanned: moments.length, opportunities: out };
}
