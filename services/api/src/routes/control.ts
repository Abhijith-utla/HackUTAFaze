// FaZe Control Room API (lead, contract v1.6). Every route is admin-only. Launch/end go through the
// existing /admin/* endpoints (same validation + publish checks), never around them.
import type { Rarity } from "@faze/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, signSession } from "../auth.js";
import { pool, tx, type Db } from "../db.js";
import { fail } from "../errors.js";
import { ensureArchive, searchArchive, toMoment } from "../control/archive.js";
import { runScan } from "../control/kam.js";
import { campaignOdds, DUPLICATE_THRESHOLD, findDuplicate, ollamaLore, shortTitle, templateDrafts } from "../control/studio.js";

const Id = z.object({ id: z.string().uuid() });
const AssetParams = z.object({ id: z.string().uuid(), assetId: z.string().uuid() });
const RarityZ = z.enum(["common", "rare", "epic", "legendary"]);

async function audit(db: Db, actor: string | null, action: string, entity: string, entityId: string | null, detail: object = {}) {
  await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)", [actor, action, entity, entityId, JSON.stringify(detail)]);
}

function toCampaign(r: any) {
  return {
    id: r.id, name: r.name, pitch: r.pitch, status: r.status, generator: r.generator,
    opportunityId: r.opportunity_id, momentId: r.moment_id,
    rightsConfirmed: r.rights_confirmed, rightsNote: r.rights_note, reviewNote: r.review_note,
    packPriceCoins: r.pack_price_coins, setId: r.set_id, packId: r.pack_id,
    createdBy: r.created_by, reviewedBy: r.reviewed_by,
    submittedAt: r.submitted_at, reviewedAt: r.reviewed_at, launchedAt: r.launched_at, endedAt: r.ended_at,
    demo: r.demo, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function toAsset(r: any) {
  return {
    id: r.id, position: r.position, name: r.name, fazeMember: r.faze_member, rarity: r.rarity as Rarity, lore: r.lore,
    artUrl: r.art_url, basePower: r.base_power, maxSupply: r.max_supply,
    duplicateOf: r.duplicate_of, duplicateName: r.duplicate_name ?? null, similarity: r.similarity === null ? null : Number(r.similarity), cardId: r.card_id,
  };
}

async function loadCampaign(db: Db, id: string) {
  const c = await db.query("SELECT * FROM campaigns WHERE id = $1", [id]);
  if (!c.rowCount) fail("NOT_FOUND", "Campaign not found");
  const assets = await db.query(
    "SELECT a.*, d.name AS duplicate_name FROM campaign_assets a LEFT JOIN cards d ON d.id = a.duplicate_of WHERE a.campaign_id = $1 ORDER BY a.position",
    [id],
  );
  const moment = c.rows[0].moment_id ? (await db.query("SELECT * FROM archive_moments WHERE id = $1", [c.rows[0].moment_id])).rows[0] : null;
  return { campaign: toCampaign(c.rows[0]), assets: assets.rows.map(toAsset), moment: moment ? toMoment(moment) : null };
}

/** Writes generated drafts for a campaign (replacing previous ones) with duplicate checks. */
async function generateAssets(db: Db, campaignId: string, m: ReturnType<typeof toMoment>) {
  const existing = (await db.query("SELECT id, name, faze_member, art_url FROM cards")).rows as { id: string; name: string; faze_member: string; art_url: string }[];
  const art = existing.filter((c) => c.art_url);
  const artFor = (member: string, i: number) => {
    const mine = art.filter((c) => c.faze_member.toLowerCase().endsWith(member.toLowerCase()));
    const pool_ = mine.length ? mine : art;
    return pool_.length ? pool_[(i * 7) % pool_.length].art_url : "";
  };
  const drafts = templateDrafts(m, artFor);
  let generator = "template";
  const llm = await ollamaLore(m, drafts);
  if (llm) { llm.lore.forEach((l, i) => (drafts[i].lore = l)); generator = `ollama:${llm.model}`; }
  await db.query("DELETE FROM campaign_assets WHERE campaign_id = $1", [campaignId]);
  const dupes = existing.map((c) => ({ id: c.id, name: c.name, fazeMember: c.faze_member }));
  for (const d of drafts) {
    const dup = findDuplicate(d.name, d.fazeMember, dupes);
    await db.query(
      `INSERT INTO campaign_assets (campaign_id, position, name, faze_member, rarity, lore, art_url, base_power, max_supply, duplicate_of, similarity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [campaignId, d.position, d.name, d.fazeMember, d.rarity, d.lore, d.artUrl, d.basePower, d.maxSupply, dup?.id ?? null, dup?.similarity ?? null],
    );
  }
  await db.query("UPDATE campaigns SET generator = $2, updated_at = now() WHERE id = $1", [campaignId, generator]);
  return generator;
}

export async function controlRoutes(app: FastifyInstance) {
  // Internal call into the existing admin API with the caller's own session (same rules apply).
  const call = async (req: FastifyRequest, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as any, headers: { cookie: req.headers.cookie ?? "" } });
    if (res.statusCode >= 300) {
      const err = (() => { try { return res.json().error; } catch { return null; } })();
      fail(err?.code ?? "CONFLICT", `${method} ${url}: ${err?.message ?? res.statusCode}`);
    }
    return res.json();
  };

  // ---------- Overview ----------
  app.get("/admin/control/overview", async (req) => {
    requireAdmin(req);
    const t0 = performance.now();
    await pool.query("SELECT 1");
    const dbMs = Math.round((performance.now() - t0) * 10) / 10;
    const k = (
      await pool.query(`SELECT
        (SELECT count(*) FROM users WHERE role='fan')::int AS collectors,
        (SELECT count(*) FROM users WHERE role='fan' AND demo)::int AS demo_collectors,
        (SELECT count(*) FROM users WHERE role='fan' AND created_at > now() - interval '24 hours')::int AS new_collectors_24h,
        (SELECT count(*) FROM pulls)::int AS packs_opened,
        (SELECT count(*) FROM pulls WHERE created_at > now() - interval '24 hours')::int AS packs_24h,
        (SELECT coalesce(-sum(amount),0) FROM ledger WHERE reason='pack_open')::int AS coins_spent,
        (SELECT coalesce(sum(amount),0) FROM ledger WHERE reason='purchase')::int AS coins_purchased,
        (SELECT coalesce(sum(lamports),0) FROM purchases WHERE status='paid')::bigint AS lamports_paid,
        (SELECT count(*) FROM purchases WHERE status='paid')::int AS purchases_paid,
        (SELECT count(*) FROM trades WHERE status='accepted')::int AS trades_accepted,
        (SELECT count(*) FROM trades WHERE status='open')::int AS trades_open,
        (SELECT count(*) FROM campaigns WHERE status='live')::int AS campaigns_live,
        (SELECT count(*) FROM campaigns WHERE status='pending_approval')::int AS approvals_pending,
        (SELECT count(*) FROM submissions WHERE status='pending')::int AS moderation_pending,
        (SELECT count(*) FROM jobs WHERE status='queued')::int AS jobs_queued,
        (SELECT count(*) FROM jobs WHERE status='failed')::int AS jobs_failed,
        (SELECT max(created_at) FROM engagement_events) AS last_engagement,
        (SELECT max(updated_at) FROM jobs WHERE status IN ('done','failed')) AS last_job`)
    ).rows[0];
    const pullsByHour = (
      await pool.query(`SELECT to_char(h, 'YYYY-MM-DD"T"HH24:00:00"Z"') AS t, coalesce(n,0)::int AS n
        FROM generate_series(date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '23 hours', date_trunc('hour', now() AT TIME ZONE 'UTC'), interval '1 hour') h
        LEFT JOIN (SELECT date_trunc('hour', created_at AT TIME ZONE 'UTC') AS b, count(*) AS n FROM pulls WHERE created_at > now() - interval '25 hours' GROUP BY 1) p ON p.b = h
        ORDER BY h`)
    ).rows;
    const coinsByDay = (
      await pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS t,
          coalesce((SELECT -sum(amount) FROM ledger WHERE reason='pack_open' AND created_at::date = d::date),0)::int AS spent,
          coalesce((SELECT sum(amount) FROM ledger WHERE reason='purchase' AND created_at::date = d::date),0)::int AS purchased
        FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`)
    ).rows;
    const topMembers = (
      await pool.query(`SELECT c.faze_member AS member, count(*)::int AS pulls
        FROM pulls p JOIN LATERAL unnest(p.card_instance_ids) iid ON true JOIN card_instances ci ON ci.id = iid JOIN cards c ON c.id = ci.card_id
        WHERE p.created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 6`)
    ).rows;
    const ago = (d: Date | null) => (d ? Math.round((Date.now() - +new Date(d)) / 1000) : null);
    return {
      kpis: {
        collectors: k.collectors, demoCollectors: k.demo_collectors, newCollectors24h: k.new_collectors_24h,
        packsOpened: k.packs_opened, packs24h: k.packs_24h, coinsSpent: k.coins_spent, coinsPurchased: k.coins_purchased,
        solReceived: Number(k.lamports_paid) / 1e9, purchasesPaid: k.purchases_paid,
        tradesAccepted: k.trades_accepted, tradesOpen: k.trades_open,
        campaignsLive: k.campaigns_live, approvalsPending: k.approvals_pending, moderationPending: k.moderation_pending,
      },
      health: { api: "ok", dbMs, jobsQueued: k.jobs_queued, jobsFailed: k.jobs_failed, workerLastEventSecondsAgo: ago(k.last_engagement), workerLastJobSecondsAgo: ago(k.last_job), cluster: "devnet" },
      series: { pullsByHour, coinsByDay },
      topMembers,
    };
  });

  // ---------- Archive ----------
  app.get<{ Querystring: { q?: string; member?: string; limit?: string } }>("/admin/control/archive", async (req) => {
    requireAdmin(req);
    await ensureArchive(pool);
    const { q = "", member, limit = "25" } = req.query;
    return { moments: await searchArchive(pool, String(q).slice(0, 200), member ? String(member).slice(0, 60) : undefined, Number(limit) || 25) };
  });

  // ---------- KAM ----------
  const latest = async () => {
    const s = await pool.query("SELECT scan_id, max(created_at) AS at FROM opportunities GROUP BY scan_id ORDER BY at DESC LIMIT 1");
    if (!s.rowCount) return { scanId: null, scannedAt: null, opportunities: [] };
    const r = await pool.query(
      `SELECT o.*, m.* , o.id AS opp_id, o.created_at AS opp_created, m.id AS m_id FROM opportunities o JOIN archive_moments m ON m.id = o.moment_id
       WHERE o.scan_id = $1 ORDER BY o.score DESC`,
      [s.rows[0].scan_id],
    );
    return {
      scanId: s.rows[0].scan_id, scannedAt: s.rows[0].at,
      opportunities: r.rows.map((x) => ({ id: x.opp_id, status: x.status, score: Number(x.score), signals: x.signals, recommendation: x.recommendation, moment: toMoment({ ...x, id: x.m_id }), createdAt: x.opp_created })),
    };
  };
  app.get("/admin/control/kam", async (req) => { requireAdmin(req); return latest(); });
  app.post("/admin/control/kam/scan", async (req) => {
    const s = requireAdmin(req);
    await ensureArchive(pool);
    const out = await runScan(pool);
    await audit(pool, s.sub, "kam.scan", "scan", out.scanId, { scanned: out.scanned, top: out.opportunities[0]?.moment.title ?? null });
    return { ...(await latest()), scanned: out.scanned };
  });
  app.post("/admin/control/opportunities/:id/dismiss", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const r = await pool.query("UPDATE opportunities SET status='dismissed' WHERE id=$1 AND status='new' RETURNING id", [id]);
    if (!r.rowCount) fail("CONFLICT", "Opportunity is not open");
    await audit(pool, s.sub, "opportunity.dismiss", "opportunity", id);
    return { ok: true };
  });

  // ---------- Campaigns ----------
  app.get("/admin/control/campaigns", async (req) => {
    requireAdmin(req);
    const r = await pool.query(
      `SELECT c.*, (SELECT count(*) FROM pulls p WHERE p.pack_id = c.pack_id)::int AS pulls
       FROM campaigns c ORDER BY c.created_at DESC LIMIT 100`,
    );
    return { campaigns: r.rows.map((x) => ({ ...toCampaign(x), pulls: x.pulls })) };
  });

  app.post("/admin/control/campaigns", async (req, reply) => {
    const s = requireAdmin(req);
    const { opportunityId } = z.object({ opportunityId: z.string().uuid() }).parse(req.body);
    const out = await tx(async (c) => {
      const o = await c.query("SELECT o.*, m.* , o.id AS opp_id, m.id AS m_id FROM opportunities o JOIN archive_moments m ON m.id = o.moment_id WHERE o.id = $1 FOR UPDATE OF o", [opportunityId]);
      if (!o.rowCount) fail("NOT_FOUND", "Opportunity not found");
      if (o.rows[0].status !== "new") fail("CONFLICT", `Opportunity already ${o.rows[0].status}`);
      const m = toMoment({ ...o.rows[0], id: o.rows[0].m_id });
      const camp = await c.query(
        "INSERT INTO campaigns (opportunity_id, moment_id, name, pitch, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [opportunityId, m.id, `Moments: ${shortTitle(m.title, 48)}`, o.rows[0].recommendation, s.sub],
      );
      await c.query("UPDATE opportunities SET status='accepted' WHERE id=$1", [opportunityId]);
      const generator = await generateAssets(c, camp.rows[0].id, m);
      await audit(c, s.sub, "campaign.create", "campaign", camp.rows[0].id, { opportunityId, moment: m.title, generator });
      return camp.rows[0].id as string;
    });
    reply.code(201);
    return loadCampaign(pool, out);
  });

  app.get("/admin/control/campaigns/:id", async (req) => { requireAdmin(req); return loadCampaign(pool, Id.parse(req.params).id); });

  app.patch("/admin/control/campaigns/:id/assets/:assetId", async (req) => {
    const s = requireAdmin(req);
    const { id, assetId } = AssetParams.parse(req.params);
    const b = z.object({ name: z.string().min(1).max(80).optional(), lore: z.string().min(1).max(400).optional(), rarity: RarityZ.optional() }).parse(req.body);
    await tx(async (c) => {
      const camp = await c.query("SELECT status FROM campaigns WHERE id=$1 FOR UPDATE", [id]);
      if (!camp.rowCount) fail("NOT_FOUND", "Campaign not found");
      if (!["draft", "rejected"].includes(camp.rows[0].status)) fail("CONFLICT", "Only draft campaigns can be edited");
      const a = await c.query("SELECT * FROM campaign_assets WHERE id=$1 AND campaign_id=$2", [assetId, id]);
      if (!a.rowCount) fail("NOT_FOUND", "Asset not found");
      const name = b.name ?? a.rows[0].name;
      const others = (await c.query("SELECT id, name, faze_member FROM cards")).rows.map((x) => ({ id: x.id, name: x.name, fazeMember: x.faze_member }));
      const dup = findDuplicate(name, a.rows[0].faze_member, others);
      await c.query("UPDATE campaign_assets SET name=$2, lore=$3, rarity=$4, duplicate_of=$5, similarity=$6 WHERE id=$1",
        [assetId, name, b.lore ?? a.rows[0].lore, b.rarity ?? a.rows[0].rarity, dup?.id ?? null, dup?.similarity ?? null]);
      await c.query("UPDATE campaigns SET status='draft', updated_at=now() WHERE id=$1", [id]);
      await audit(c, s.sub, "asset.edit", "campaign", id, { assetId, fields: Object.keys(b) });
    });
    return loadCampaign(pool, id);
  });

  app.post("/admin/control/campaigns/:id/regenerate", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    await tx(async (c) => {
      const camp = await c.query("SELECT * FROM campaigns WHERE id=$1 FOR UPDATE", [id]);
      if (!camp.rowCount) fail("NOT_FOUND", "Campaign not found");
      if (!["draft", "rejected"].includes(camp.rows[0].status)) fail("CONFLICT", "Only draft campaigns can be regenerated");
      const m = toMoment((await c.query("SELECT * FROM archive_moments WHERE id=$1", [camp.rows[0].moment_id])).rows[0]);
      const generator = await generateAssets(c, id, m);
      await c.query("UPDATE campaigns SET status='draft' WHERE id=$1", [id]);
      await audit(c, s.sub, "campaign.regenerate", "campaign", id, { generator });
    });
    return loadCampaign(pool, id);
  });

  app.post("/admin/control/campaigns/:id/submit", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const r = await pool.query("UPDATE campaigns SET status='pending_approval', submitted_at=now(), updated_at=now() WHERE id=$1 AND status IN ('draft','rejected') RETURNING id", [id]);
    if (!r.rowCount) fail("CONFLICT", "Only draft campaigns can be submitted");
    await audit(pool, s.sub, "campaign.submit", "campaign", id);
    return loadCampaign(pool, id);
  });

  app.post("/admin/control/campaigns/:id/review", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = z.object({ decision: z.enum(["approve", "reject"]), rightsConfirmed: z.boolean().default(false), rightsNote: z.string().max(500).default(""), note: z.string().max(500).default("") }).parse(req.body);
    await tx(async (c) => {
      const camp = await c.query("SELECT status FROM campaigns WHERE id=$1 FOR UPDATE", [id]);
      if (!camp.rowCount) fail("NOT_FOUND", "Campaign not found");
      if (camp.rows[0].status !== "pending_approval") fail("CONFLICT", "Campaign is not awaiting approval");
      if (b.decision === "approve") {
        if (!b.rightsConfirmed) fail("VALIDATION", "Confirm rights/licensing for the moment and art before approving");
        const d = await c.query("SELECT name FROM campaign_assets WHERE campaign_id=$1 AND similarity >= $2", [id, DUPLICATE_THRESHOLD]);
        if (d.rowCount) fail("VALIDATION", `Resolve duplicate card names first: ${d.rows.map((x) => x.name).join(", ")}`);
      }
      await c.query(
        "UPDATE campaigns SET status=$2, rights_confirmed=$3, rights_note=$4, review_note=$5, reviewed_by=$6, reviewed_at=now(), updated_at=now() WHERE id=$1",
        [id, b.decision === "approve" ? "approved" : "rejected", b.rightsConfirmed, b.rightsNote, b.note, s.sub],
      );
      await audit(c, s.sub, `campaign.${b.decision}`, "campaign", id, { rightsConfirmed: b.rightsConfirmed, note: b.note });
    });
    return loadCampaign(pool, id);
  });

  app.post("/admin/control/campaigns/:id/launch", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = z.object({ packPriceCoins: z.number().int().positive().max(100000).optional() }).parse(req.body ?? {});
    // Claim the launch so two clicks can't create two sets.
    const claim = await pool.query("UPDATE campaigns SET status='live', launched_at=now(), pack_price_coins=coalesce($2, pack_price_coins), updated_at=now() WHERE id=$1 AND status='approved' RETURNING *", [id, b.packPriceCoins ?? null]);
    if (!claim.rowCount) fail("CONFLICT", "Only approved campaigns can launch");
    const camp = claim.rows[0];
    try {
      const { assets } = await loadCampaign(pool, id);
      const set = (await call(req, "POST", "/admin/sets", { name: camp.name.slice(0, 80), description: `${camp.pitch}`.slice(0, 500) })).set;
      for (const a of assets) {
        const card = (await call(req, "POST", "/admin/cards", { setId: set.id, name: a.name, fazeMember: a.fazeMember, rarity: a.rarity, artUrl: a.artUrl, basePower: a.basePower, maxSupply: a.maxSupply })).card;
        await pool.query("UPDATE campaign_assets SET card_id=$2 WHERE id=$1", [a.id, card.id]);
      }
      const pack = (await call(req, "POST", "/admin/packs", { setId: set.id, name: `${camp.name}`.slice(0, 72) + " Pack", priceCoins: camp.pack_price_coins, cardsPerPack: 5, odds: campaignOdds(assets.map((a) => a.rarity)) })).pack;
      await call(req, "POST", `/admin/sets/${set.id}/publish`);
      await pool.query("UPDATE campaigns SET set_id=$2, pack_id=$3, updated_at=now() WHERE id=$1", [id, set.id, pack.id]);
      await audit(pool, s.sub, "campaign.launch", "campaign", id, { setId: set.id, packId: pack.id, cards: assets.length, priceCoins: camp.pack_price_coins });
    } catch (e) {
      await pool.query("UPDATE campaigns SET status='approved', launched_at=NULL WHERE id=$1", [id]);
      await audit(pool, s.sub, "campaign.launch_failed", "campaign", id, { error: (e as Error).message });
      throw e;
    }
    return loadCampaign(pool, id);
  });

  app.post("/admin/control/campaigns/:id/end", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const r = await pool.query("UPDATE campaigns SET status='ended', ended_at=now(), updated_at=now() WHERE id=$1 AND status='live' RETURNING set_id, pack_id", [id]);
    if (!r.rowCount) fail("CONFLICT", "Only live campaigns can end");
    if (r.rows[0].pack_id) await call(req, "PATCH", `/admin/packs/${r.rows[0].pack_id}`, { active: false });
    if (r.rows[0].set_id) await call(req, "PATCH", `/admin/sets/${r.rows[0].set_id}`, { status: "retired" });
    await audit(pool, s.sub, "campaign.end", "campaign", id);
    return loadCampaign(pool, id);
  });

  app.get("/admin/control/campaigns/:id/metrics", async (req) => {
    requireAdmin(req);
    const { id } = Id.parse(req.params);
    const c = (await pool.query("SELECT * FROM campaigns WHERE id=$1", [id])).rows[0];
    if (!c) fail("NOT_FOUND", "Campaign not found");
    if (!c.pack_id) return { launched: false };
    const m = (
      await pool.query(
        `WITH p AS (SELECT * FROM pulls WHERE pack_id = $1),
              inst AS (SELECT unnest(card_instance_ids) AS iid FROM p)
         SELECT (SELECT count(*) FROM p)::int AS pulls,
                (SELECT count(DISTINCT user_id) FROM p)::int AS collectors,
                (SELECT count(DISTINCT p.user_id) FROM p JOIN users u ON u.id = p.user_id WHERE u.demo)::int AS demo_collectors,
                (SELECT coalesce(-sum(l.amount),0) FROM ledger l JOIN p ON l.ref_id = p.id::text WHERE l.reason='pack_open')::int AS coins,
                (SELECT count(*) FROM inst)::int AS cards_minted,
                (SELECT count(*) FROM trades t WHERE t.status='accepted' AND (t.offered_instance_ids && (SELECT array_agg(iid) FROM inst) OR t.requested_instance_ids && (SELECT array_agg(iid) FROM inst)))::int AS trades,
                (SELECT coalesce(avg(s.hype),0) FROM card_stats s JOIN cards cd ON cd.id = s.card_id WHERE cd.set_id = $2)::float AS hype`,
        [c.pack_id, c.set_id],
      )
    ).rows[0];
    // Devnet purchases by campaign collectors in the 24h before their first campaign pull (last-touch attribution).
    const attributed = (
      await pool.query(
        `WITH first AS (SELECT user_id, min(created_at) AS at FROM pulls WHERE pack_id = $1 GROUP BY user_id)
         SELECT count(*)::int AS n, coalesce(sum(pu.lamports),0)::bigint AS lamports FROM purchases pu JOIN first f ON f.user_id = pu.user_id
         WHERE pu.status='paid' AND pu.paid_at BETWEEN f.at - interval '24 hours' AND f.at`,
        [c.pack_id],
      )
    ).rows[0];
    const series = (
      await pool.query(
        // every minute from launch to now (or end), capped at the last 120 minutes, zeros included
        `SELECT to_char(m, 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS t, coalesce(p.n, 0)::int AS n
         FROM generate_series(
                greatest(date_trunc('minute', $2::timestamptz AT TIME ZONE 'UTC') - interval '1 minute', date_trunc('minute', coalesce($3::timestamptz, now()) AT TIME ZONE 'UTC') - interval '119 minutes'),
                date_trunc('minute', coalesce($3::timestamptz, now()) AT TIME ZONE 'UTC'), interval '1 minute') m
         LEFT JOIN (SELECT date_trunc('minute', created_at AT TIME ZONE 'UTC') AS b, count(*) AS n FROM pulls WHERE pack_id = $1 GROUP BY 1) p ON p.b = m
         ORDER BY m`,
        [c.pack_id, c.launched_at, c.ended_at],
      )
    ).rows;
    const rarity = (
      await pool.query(
        `SELECT cd.rarity, count(*)::int AS n FROM pulls p JOIN LATERAL unnest(p.card_instance_ids) iid ON true
         JOIN card_instances ci ON ci.id = iid JOIN cards cd ON cd.id = ci.card_id WHERE p.pack_id = $1 GROUP BY 1`,
        [c.pack_id],
      )
    ).rows;
    return {
      launched: true,
      pulls: m.pulls, collectors: m.collectors, demoCollectors: m.demo_collectors, coinsSpent: m.coins, cardsMinted: m.cards_minted,
      tradesInvolvingDrop: m.trades, avgHype: Math.round(m.hype), attributedPurchases: attributed.n, attributedSol: Number(attributed.lamports) / 1e9,
      attribution: "last-touch: devnet purchases in the 24h before a collector's first pull of this drop",
      rarityMix: rarity, pullsByMinute: series,
    };
  });

  // Demo-only load generator: creates labelled demo collectors who open the drop through the REAL pack-open path.
  app.post("/admin/control/campaigns/:id/simulate", async (req) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const { collectors } = z.object({ collectors: z.number().int().min(1).max(40).default(12) }).parse(req.body ?? {});
    const c = (await pool.query("SELECT * FROM campaigns WHERE id=$1", [id])).rows[0];
    if (!c) fail("NOT_FOUND", "Campaign not found");
    if (c.status !== "live" || !c.pack_id) fail("CONFLICT", "Campaign must be live to simulate collectors");
    let opened = 0;
    for (let i = 0; i < collectors; i++) {
      const u = await pool.query(
        "INSERT INTO users (email, password_hash, display_name, role, display_name_status, demo) VALUES ($1,'!demo-no-login',$2,'fan','approved',true) RETURNING id",
        [`sim-${randomUUID()}@demo.faze`, `Demo collector ${Math.floor(Math.random() * 9000 + 1000)}`],
      );
      const uid = u.rows[0].id as string;
      const packs = 1 + (i % 3);
      await pool.query("INSERT INTO ledger (user_id, amount, reason, ref_id, idempotency_key, demo) VALUES ($1,$2,'admin_grant',$3,$4,true)", [uid, c.pack_price_coins * packs, `sim:${id}`, `sim:${id}:${uid}`]);
      for (let k = 0; k < packs; k++) {
        const r = await app.inject({ method: "POST", url: `/packs/${c.pack_id}/open`, payload: { idempotencyKey: randomUUID() }, headers: { cookie: `session=${signSession(uid, "fan")}` } });
        if (r.statusCode < 300) opened++;
      }
    }
    await audit(pool, s.sub, "campaign.simulate", "campaign", id, { collectors, packsOpened: opened, demo: true });
    return { collectors, packsOpened: opened, demo: true };
  });

  // ---------- Audit ----------
  app.get<{ Querystring: { limit?: string } }>("/admin/control/audit", async (req) => {
    requireAdmin(req);
    const r = await pool.query(
      `SELECT a.*, u.display_name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT $1`,
      [Math.min(Number(req.query.limit) || 50, 200)],
    );
    return { entries: r.rows.map((x) => ({ id: Number(x.id), actor: x.actor, action: x.action, entity: x.entity, entityId: x.entity_id, detail: x.detail, createdAt: x.created_at })) };
  });
}
