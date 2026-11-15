// FaZe Control Room (lead, contract v1.8): Fan Intelligence, Revenue & Sponsors, Trust & Operations.
// Read-mostly analytics over existing tables; sponsors are the only new data. Every route is admin-only.
import { RARITY_SCORE } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { pool, type Db } from "../db.js";
import { fail } from "../errors.js";

const Id = z.object({ id: z.string().uuid() });
const SponsorCategory = z.enum(["energy_drink", "apparel", "tech", "gaming_hardware", "food_beverage", "auto", "entertainment", "other"]);
/** Brands that must never sponsor a youth collectibles drop. */
const UNFIT_SPONSOR = /\b(bet|bets|betting|sportsbook|gambl\w*|casino|igaming|poker|lottery|vape|vaping|tobacco|cigar\w*|nicotine|alcohol|beer|vodka|whisk(e)?y|liquor|cannabis|weed|crypto\s*casino)\b/i;
export function sponsorFit(name: string, notes = ""): { ok: boolean; reason: string } {
  const hit = UNFIT_SPONSOR.exec(`${name} ${notes}`);
  return hit ? { ok: false, reason: `not allowed for a youth collectibles audience: ${hit[0].toLowerCase()}` } : { ok: true, reason: "" };
}

async function audit(db: Db, actor: string, action: string, entity: string, entityId: string | null, detail: object = {}) {
  await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)", [actor, action, entity, entityId, JSON.stringify(detail)]);
}

// Every fan-side activity we can observe: pack opens, trades (either side) and paid purchases.
const ACTIVITY = `
  SELECT user_id, created_at AS at FROM pulls
  UNION ALL SELECT from_user_id, created_at FROM trades
  UNION ALL SELECT to_user_id, resolved_at FROM trades WHERE status = 'accepted' AND resolved_at IS NOT NULL
  UNION ALL SELECT user_id, paid_at FROM purchases WHERE status = 'paid' AND paid_at IS NOT NULL`;

const scoreCase = `CASE c.rarity ${Object.entries(RARITY_SCORE).map(([r, s]) => `WHEN '${r}' THEN ${s}`).join(" ")} ELSE 0 END`;

export async function insightsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/admin/control/fans") || req.url.startsWith("/admin/control/revenue") || req.url.startsWith("/admin/control/sponsors") || req.url.startsWith("/admin/control/ops")) requireAdmin(req);
  });

  // ---------- Fan Intelligence ----------
  app.get("/admin/control/fans", async () => {
    const funnel = (
      await pool.query(`WITH f AS (SELECT id FROM users WHERE role='fan')
        SELECT (SELECT count(*) FROM f)::int AS signed_up,
          (SELECT count(DISTINCT p.user_id) FROM pulls p JOIN f ON f.id = p.user_id)::int AS opened_pack,
          (SELECT count(DISTINCT pu.user_id) FROM purchases pu JOIN f ON f.id = pu.user_id WHERE pu.status='paid')::int AS bought_coins,
          (SELECT count(DISTINCT u) FROM (SELECT from_user_id AS u FROM trades WHERE status='accepted' UNION SELECT to_user_id FROM trades WHERE status='accepted') t JOIN f ON f.id = t.u)::int AS traded`)
    ).rows[0];

    const cohorts = (
      await pool.query(`WITH act AS (${ACTIVITY}),
        f AS (SELECT id, created_at FROM users WHERE role='fan' AND created_at >= current_date - 13)
        SELECT to_char(date_trunc('day', f.created_at), 'YYYY-MM-DD') AS day,
          (current_date - date_trunc('day', f.created_at)::date)::int AS age_days,
          count(*)::int AS size,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act a WHERE a.user_id = f.id AND a.at < f.created_at + interval '1 day'))::int AS activated_d0,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act a WHERE a.user_id = f.id AND a.at >= f.created_at + interval '1 day'))::int AS retained_d1,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act a WHERE a.user_id = f.id AND a.at >= f.created_at + interval '3 days'))::int AS retained_d3,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act a WHERE a.user_id = f.id AND a.at >= f.created_at + interval '7 days'))::int AS retained_d7
        FROM f GROUP BY 1, 2 ORDER BY 1`)
    ).rows;

    const segments = (
      await pool.query(`WITH act AS (${ACTIVITY}),
        last AS (SELECT user_id, max(at) AS at FROM act GROUP BY 1),
        f AS (SELECT u.id, u.created_at, l.at AS last_at FROM users u LEFT JOIN last l ON l.user_id = u.id WHERE u.role='fan')
        SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new,
          count(*) FILTER (WHERE created_at <= now() - interval '7 days' AND last_at > now() - interval '7 days')::int AS active,
          count(*) FILTER (WHERE created_at <= now() - interval '7 days' AND last_at <= now() - interval '7 days')::int AS dormant,
          count(*) FILTER (WHERE created_at <= now() - interval '7 days' AND last_at IS NULL)::int AS never_activated,
          count(*) FILTER (WHERE last_at > now() - interval '24 hours')::int AS active_24h
        FROM f`)
    ).rows[0];

    // Spend concentration: share of pack spend from the top 10% of spenders.
    const spend = (
      await pool.query(`WITH s AS (SELECT l.user_id, -sum(l.amount) AS coins FROM ledger l JOIN users u ON u.id = l.user_id AND u.role='fan' WHERE l.reason='pack_open' GROUP BY 1),
        r AS (SELECT coins, ntile(10) OVER (ORDER BY coins DESC) AS decile FROM s)
        SELECT count(*)::int AS spenders, coalesce(sum(coins),0)::int AS total, coalesce(sum(coins) FILTER (WHERE decile = 1),0)::int AS top_decile FROM r`)
    ).rows[0];

    const members = (
      await pool.query(`SELECT c.faze_member AS member, count(*)::int AS owned
        FROM card_instances ci JOIN cards c ON c.id = ci.card_id JOIN users u ON u.id = ci.owner_id AND u.role='fan'
        GROUP BY 1 ORDER BY 2 DESC`)
    ).rows as { member: string; owned: number }[];
    const totalOwned = members.reduce((a, m) => a + m.owned, 0);
    const hhi = totalOwned ? members.reduce((a, m) => a + (m.owned / totalOwned) ** 2, 0) : 0;
    const topShare = totalOwned && members[0] ? members[0].owned / totalOwned : 0;

    const top = (
      await pool.query(`WITH act AS (${ACTIVITY}), last AS (SELECT user_id, max(at) AS at FROM act GROUP BY 1)
        SELECT u.id, CASE WHEN u.display_name_status='approved' THEN u.display_name ELSE 'New collector' END AS name, u.demo,
          count(ci.id)::int AS cards, coalesce(sum(${scoreCase}),0)::int AS score,
          (SELECT coalesce(-sum(amount),0) FROM ledger WHERE user_id = u.id AND reason='pack_open')::int AS coins_spent,
          (SELECT at FROM last WHERE last.user_id = u.id) AS last_active
        FROM users u LEFT JOIN card_instances ci ON ci.owner_id = u.id LEFT JOIN cards c ON c.id = ci.card_id
        WHERE u.role='fan' GROUP BY u.id ORDER BY score DESC, cards DESC LIMIT 10`)
    ).rows;

    return {
      funnel: { signedUp: funnel.signed_up, openedPack: funnel.opened_pack, boughtCoins: funnel.bought_coins, traded: funnel.traded },
      cohorts: cohorts.map((c) => ({ day: c.day, ageDays: c.age_days, size: c.size, activatedD0: c.activated_d0, retainedD1: c.age_days >= 1 ? c.retained_d1 : null, retainedD3: c.age_days >= 3 ? c.retained_d3 : null, retainedD7: c.age_days >= 7 ? c.retained_d7 : null })),
      segments: { new: segments.new, active: segments.active, dormant: segments.dormant, neverActivated: segments.never_activated, active24h: segments.active_24h },
      spend: { spenders: spend.spenders, totalCoins: spend.total, topDecileShare: spend.total ? spend.top_decile / spend.total : 0 },
      creatorDependence: {
        members: members.slice(0, 12).map((m) => ({ member: m.member, owned: m.owned, share: totalOwned ? m.owned / totalOwned : 0 })),
        hhi: Math.round(hhi * 1000) / 1000,
        topMemberShare: Math.round(topShare * 1000) / 1000,
        risk: hhi >= 0.25 ? "high" : hhi >= 0.15 ? "moderate" : "diversified",
        note: "Herfindahl–Hirschman index over cards owned by fans, by FaZe member. High = the collection economy leans on one creator.",
      },
      topCollectors: top.map((t) => ({ id: t.id, name: t.name, demo: t.demo, cards: t.cards, score: t.score, coinsSpent: t.coins_spent, lastActive: t.last_active })),
    };
  });

  // ---------- Revenue & Sponsors ----------
  app.get("/admin/control/revenue", async () => {
    const p = (
      await pool.query(`SELECT count(*)::int AS paid, coalesce(sum(lamports),0)::bigint AS lamports, count(DISTINCT user_id)::int AS payers,
          (SELECT count(*) FROM users WHERE role='fan')::int AS fans,
          count(*) FILTER (WHERE paid_at > now() - interval '24 hours')::int AS paid_24h
        FROM purchases WHERE status='paid'`)
    ).rows[0];
    const byBundle = (await pool.query(`SELECT bundle_id AS bundle, count(*)::int AS n, sum(coins)::int AS coins, sum(lamports)::bigint AS lamports FROM purchases WHERE status='paid' GROUP BY 1 ORDER BY 4 DESC`)).rows;
    const byDay = (
      await pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS t, coalesce((SELECT sum(lamports) FROM purchases WHERE status='paid' AND paid_at::date = d::date),0)::bigint AS lamports
        FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`)
    ).rows;
    const eco = (
      await pool.query(`SELECT reason, coalesce(sum(amount),0)::bigint AS total FROM ledger l JOIN users u ON u.id = l.user_id AND u.role='fan' GROUP BY 1`)
    ).rows as { reason: string; total: string }[];
    const r = (k: string) => Number(eco.find((x) => x.reason === k)?.total ?? 0);
    const issued = r("signup_bonus") + r("purchase") + r("admin_grant");
    const sunk = -r("pack_open");
    const campaigns = (
      await pool.query(`SELECT c.id, c.name, c.status, c.pack_price_coins, c.launched_at,
          (SELECT count(*) FROM pulls WHERE pack_id = c.pack_id)::int AS pulls,
          (SELECT count(DISTINCT user_id) FROM pulls WHERE pack_id = c.pack_id)::int AS collectors,
          (SELECT coalesce(-sum(l.amount),0) FROM ledger l JOIN pulls p ON l.ref_id = p.id::text WHERE p.pack_id = c.pack_id AND l.reason='pack_open')::int AS coins,
          (SELECT coalesce(sum(fee_usd),0) FROM sponsor_activations WHERE campaign_id = c.id)::float AS sponsor_fees
        FROM campaigns c WHERE c.pack_id IS NOT NULL ORDER BY c.launched_at DESC NULLS LAST LIMIT 20`)
    ).rows;
    const sol = Number(p.lamports) / 1e9;
    return {
      purchases: { paid: p.paid, paid24h: p.paid_24h, sol, payers: p.payers, conversion: p.fans ? p.payers / p.fans : 0, arppuSol: p.payers ? sol / p.payers : 0, cluster: "devnet", testFunds: true },
      byBundle: byBundle.map((b) => ({ bundle: b.bundle, purchases: b.n, coins: b.coins, sol: Number(b.lamports) / 1e9 })),
      solByDay: byDay.map((d) => ({ t: d.t, sol: Number(d.lamports) / 1e9 })),
      economy: { issued, issuedBy: { signupBonus: r("signup_bonus"), purchased: r("purchase"), adminGrant: r("admin_grant") }, sunk, outstanding: issued - sunk, sinkRatio: issued ? sunk / issued : 0 },
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, priceCoins: c.pack_price_coins, pulls: c.pulls, collectors: c.collectors, coins: c.coins, sponsorFeesUsd: c.sponsor_fees })),
    };
  });

  app.get("/admin/control/sponsors", async () => {
    const s = (await pool.query("SELECT * FROM sponsors ORDER BY created_at DESC")).rows;
    const a = (
      await pool.query(`SELECT a.*, c.name AS campaign_name, c.status AS campaign_status,
          (SELECT count(*) FROM pulls WHERE pack_id = c.pack_id)::int AS pulls,
          (SELECT count(DISTINCT user_id) FROM pulls WHERE pack_id = c.pack_id)::int AS collectors
        FROM sponsor_activations a JOIN campaigns c ON c.id = a.campaign_id ORDER BY a.created_at DESC`)
    ).rows;
    return {
      sponsors: s.map((x) => {
        const acts = a.filter((y) => y.sponsor_id === x.id).map((y) => ({
          id: y.id, campaignId: y.campaign_id, campaignName: y.campaign_name, campaignStatus: y.campaign_status, feeUsd: Number(y.fee_usd), deliverables: y.deliverables,
          status: y.status, createdAt: y.created_at, endedAt: y.ended_at, packOpens: y.pulls, collectorsReached: y.collectors,
          costPerCollectorUsd: y.collectors ? Math.round((Number(y.fee_usd) / y.collectors) * 100) / 100 : null,
        }));
        const fee = acts.reduce((t, y) => t + y.feeUsd, 0), reach = acts.reduce((t, y) => t + y.collectorsReached, 0);
        return { id: x.id, name: x.name, category: x.category, notes: x.notes, status: x.status, demo: x.demo, createdAt: x.created_at, activations: acts, totalFeeUsd: fee, collectorsReached: reach, opens: acts.reduce((t, y) => t + y.packOpens, 0) };
      }),
      note: "Fees are demo contract values for reporting; reach = unique collectors who opened the sponsored drop's pack.",
    };
  });

  app.post("/admin/control/sponsors", async (req, reply) => {
    const s = requireAdmin(req);
    const b = z.object({ name: z.string().trim().min(2).max(80), category: SponsorCategory, notes: z.string().max(500).default("") }).parse(req.body);
    const fit = sponsorFit(b.name, b.notes);
    if (!fit.ok) fail("VALIDATION", `Sponsor ${fit.reason}`);
    const r = await pool.query("INSERT INTO sponsors (name, category, notes, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING RETURNING id", [b.name, b.category, b.notes, s.sub]);
    if (!r.rowCount) fail("CONFLICT", "A sponsor with that name already exists");
    await audit(pool, s.sub, "sponsor.create", "sponsor", r.rows[0].id, { name: b.name, category: b.category });
    reply.code(201);
    return { id: r.rows[0].id };
  });

  app.post("/admin/control/sponsors/:id/activations", async (req, reply) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = z.object({ campaignId: z.string().uuid(), feeUsd: z.number().min(0).max(10_000_000).default(0), deliverables: z.string().max(500).default("") }).parse(req.body);
    const sp = (await pool.query("SELECT status FROM sponsors WHERE id=$1", [id])).rows[0];
    if (!sp) fail("NOT_FOUND", "Sponsor not found");
    if (sp.status !== "active") fail("CONFLICT", "Sponsor is paused");
    const c = (await pool.query("SELECT status FROM campaigns WHERE id=$1", [b.campaignId])).rows[0];
    if (!c) fail("NOT_FOUND", "Campaign not found");
    if (!["approved", "live", "ended"].includes(c.status)) fail("CONFLICT", "Attach sponsors to approved, live or ended campaigns only");
    const r = await pool.query(
      "INSERT INTO sponsor_activations (sponsor_id, campaign_id, fee_usd, deliverables, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sponsor_id, campaign_id) DO NOTHING RETURNING id",
      [id, b.campaignId, b.feeUsd, b.deliverables, s.sub],
    );
    if (!r.rowCount) fail("CONFLICT", "This sponsor is already on that campaign");
    await audit(pool, s.sub, "sponsor.activate", "sponsor", id, { campaignId: b.campaignId, feeUsd: b.feeUsd, demo: true });
    reply.code(201);
    return { id: r.rows[0].id };
  });

  app.post("/admin/control/sponsors/activations/:id/end", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const r = await pool.query("UPDATE sponsor_activations SET status='ended', ended_at=now() WHERE id=$1 AND status='active' RETURNING sponsor_id", [id]);
    if (!r.rowCount) fail("CONFLICT", "Activation is not active");
    await audit(pool, s.sub, "sponsor.end_activation", "sponsor", r.rows[0].sponsor_id, { activationId: id });
    return { ok: true };
  });

  app.patch("/admin/control/sponsors/:id", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = z.object({ status: z.enum(["active", "paused"]) }).parse(req.body);
    const r = await pool.query("UPDATE sponsors SET status=$2 WHERE id=$1 RETURNING id", [id, b.status]);
    if (!r.rowCount) fail("NOT_FOUND", "Sponsor not found");
    await audit(pool, s.sub, `sponsor.${b.status === "paused" ? "pause" : "resume"}`, "sponsor", id);
    return { ok: true };
  });

  // ---------- Trust & Operations ----------
  app.get("/admin/control/ops", async () => {
    const t0 = performance.now();
    await pool.query("SELECT 1");
    const dbMs = Math.round((performance.now() - t0) * 10) / 10;
    const jobs = (await pool.query("SELECT kind, status, count(*)::int AS n FROM jobs GROUP BY 1, 2 ORDER BY 1, 2")).rows;
    const recentJobs = (await pool.query("SELECT id, kind, status, error, created_at, updated_at FROM jobs ORDER BY updated_at DESC LIMIT 15")).rows;
    const pending = (
      await pool.query(`SELECT s.id, s.kind, s.auto_flags, s.created_at,
          -- never pull fan-art image bytes (up to 2 MB each) just to list the queue
          jsonb_build_object('displayName', s.payload->>'displayName', 'message', s.payload->>'message', 'name', s.payload->>'name') AS payload,
          CASE WHEN u.display_name_status='approved' THEN u.display_name ELSE 'New collector' END AS author
        FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.status='pending' ORDER BY s.created_at LIMIT 30`)
    ).rows;
    const rights = (
      await pool.query(`SELECT c.id, c.name, c.status, c.rights_confirmed, c.rights_note, c.review_note, c.reviewed_at, c.launched_at, m.source, r.display_name AS reviewer
        FROM campaigns c LEFT JOIN archive_moments m ON m.id = c.moment_id LEFT JOIN users r ON r.id = c.reviewed_by
        WHERE c.status IN ('approved','live','ended','rejected') ORDER BY c.reviewed_at DESC NULLS LAST LIMIT 30`)
    ).rows;
    const hb = (await pool.query("SELECT (SELECT max(created_at) FROM engagement_events) AS last_event, (SELECT max(updated_at) FROM jobs WHERE status IN ('done','failed')) AS last_job")).rows[0];
    const migrations = (await pool.query("SELECT name, applied_at FROM schema_migrations ORDER BY name")).rows;
    const users = (await pool.query("SELECT role, demo, count(*)::int AS n FROM users GROUP BY 1, 2")).rows;
    const summarize = (kind: string, payload: any) =>
      kind === "display_name" ? `Display name: ${String(payload?.displayName ?? payload?.name ?? "").slice(0, 60)}` :
      kind === "trade_message" ? `Trade message: ${String(payload?.message ?? "").slice(0, 80)}` :
      `Fan art: ${String(payload?.name ?? "untitled").slice(0, 60)}`;
    return {
      health: { api: "ok", dbMs, lastEngagementEvent: hb.last_event, lastJobFinished: hb.last_job, cluster: "devnet" },
      jobs: { byKindStatus: jobs, recent: recentJobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, error: j.error, createdAt: j.created_at, updatedAt: j.updated_at })) },
      moderation: pending.map((x) => ({ id: x.id, kind: x.kind, author: x.author, summary: summarize(x.kind, x.payload), autoFlags: x.auto_flags, createdAt: x.created_at })),
      rights: rights.map((x) => ({ id: x.id, name: x.name, status: x.status, rightsConfirmed: x.rights_confirmed, rightsNote: x.rights_note, reviewNote: x.review_note, reviewer: x.reviewer, reviewedAt: x.reviewed_at, launchedAt: x.launched_at, source: x.source })),
      migrations: migrations.map((m) => ({ name: m.name, appliedAt: m.applied_at })),
      users: users.map((u) => ({ role: u.role, demo: u.demo, count: u.n })),
    };
  });
}
