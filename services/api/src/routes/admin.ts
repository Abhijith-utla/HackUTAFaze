import { ModerationDecisionBody, ModerationStatus, Odds, Rarity, SetStatus, SpikeBody, type Pack } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { toCard, toSet, toSubmission } from "../mappers.js";

const Id = z.object({ id: z.string().uuid() });

const SetCreate = z.object({ name: z.string().min(1).max(80), description: z.string().max(500).default("") });
const SetPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  status: SetStatus.optional(),
});

const CardCreate = z.object({
  setId: z.string().uuid(),
  name: z.string().min(1).max(80),
  fazeMember: z.string().min(1).max(60),
  rarity: Rarity,
  artUrl: z.string().max(2000).default(""),
  basePower: z.number().int().min(0).default(0),
  maxSupply: z.number().int().positive().nullable().optional(),
});
const CardPatch = CardCreate.omit({ setId: true }).partial();

function checkOdds(odds: Record<string, number>) {
  const sum = Object.values(odds).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-9) fail("VALIDATION", `odds must sum to 100 (got ${sum})`);
}
const PackOdds = Odds.refine((o) => Object.keys(o).length > 0, "odds must not be empty");
const PackCreate = z.object({
  setId: z.string().uuid(),
  name: z.string().min(1).max(80),
  priceCoins: z.number().int().positive(),
  cardsPerPack: z.number().int().positive().max(20),
  odds: PackOdds,
});
const PackPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  priceCoins: z.number().int().positive().optional(),
  cardsPerPack: z.number().int().positive().max(20).optional(),
  odds: PackOdds.optional(),
  active: z.boolean().optional(),
});

function toPack(r: any): Pack & { active: boolean } {
  return {
    id: r.id,
    name: r.name,
    setId: r.set_id,
    priceCoins: r.price_coins,
    cardsPerPack: r.cards_per_pack,
    odds: r.odds,
    oddsVersion: r.odds_version,
    active: r.active,
  };
}

/** Builds "col = $n" pairs for a PATCH from a {column: value} map, skipping undefined. */
function setClause(fields: Record<string, unknown>, start = 2) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    vals.push(v);
    cols.push(`${k} = $${start + vals.length - 1}`);
  }
  return { cols, vals };
}

export async function adminRoutes(app: FastifyInstance) {
  // ---------- sets ----------
  app.get("/admin/sets", async (req) => {
    requireAdmin(req);
    const r = await pool.query("SELECT * FROM card_sets ORDER BY name");
    return { sets: r.rows.map(toSet) };
  });

  app.post("/admin/sets", async (req, reply) => {
    requireAdmin(req);
    const b = SetCreate.parse(req.body);
    const r = await pool.query("INSERT INTO card_sets (name, description) VALUES ($1,$2) RETURNING *", [
      b.name.trim(),
      b.description,
    ]);
    return reply.status(201).send({ set: toSet(r.rows[0]) });
  });

  app.patch("/admin/sets/:id", async (req) => {
    requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = SetPatch.parse(req.body ?? {});
    const { cols, vals } = setClause({ name: b.name?.trim(), description: b.description, status: b.status });
    if (b.status === "live") cols.push("published_at = COALESCE(published_at, now())");
    const r = cols.length
      ? await pool.query(`UPDATE card_sets SET ${cols.join(", ")} WHERE id=$1 RETURNING *`, [id, ...vals])
      : await pool.query("SELECT * FROM card_sets WHERE id=$1", [id]);
    if (!r.rowCount) fail("NOT_FOUND", "Set not found");
    return { set: toSet(r.rows[0]) };
  });

  app.post("/admin/sets/:id/publish", async (req) => {
    requireAdmin(req);
    const { id } = Id.parse(req.params);
    const set = await tx(async (c) => {
      const s = await c.query("SELECT * FROM card_sets WHERE id=$1 FOR UPDATE", [id]);
      if (!s.rowCount) fail("NOT_FOUND", "Set not found");
      const cards = await c.query("SELECT name, art_url FROM cards WHERE set_id=$1", [id]);
      if (!cards.rowCount) fail("VALIDATION", "Set has no cards");
      const noArt = cards.rows.filter((r) => !r.art_url || !String(r.art_url).trim());
      if (noArt.length) fail("VALIDATION", `Cards missing art: ${noArt.map((r) => r.name).join(", ")}`);
      const packs = await c.query("SELECT name, odds FROM packs WHERE set_id=$1 AND active", [id]);
      if (!packs.rowCount) fail("VALIDATION", "Set has no active pack");
      for (const p of packs.rows) {
        const sum = Object.values(p.odds as Record<string, number>).reduce((a, b) => a + Number(b), 0);
        if (Math.abs(sum - 100) > 1e-9) fail("VALIDATION", `Pack "${p.name}" odds sum to ${sum}, must be 100`);
      }
      const u = await c.query(
        "UPDATE card_sets SET status='live', published_at=COALESCE(published_at, now()) WHERE id=$1 RETURNING *",
        [id],
      );
      await c.query("INSERT INTO jobs (kind, payload) VALUES ('publish_set', $1)", [{ setId: id }]);
      return u.rows[0];
    });
    return { set: toSet(set) };
  });

  // ---------- cards ----------
  app.get("/admin/cards", async (req) => {
    requireAdmin(req);
    const q = z.object({ setId: z.string().uuid().optional() }).parse(req.query ?? {});
    const r = q.setId
      ? await pool.query("SELECT * FROM cards WHERE set_id=$1 ORDER BY name", [q.setId])
      : await pool.query("SELECT * FROM cards ORDER BY name");
    return { cards: r.rows.map(toCard) };
  });

  app.post("/admin/cards", async (req, reply) => {
    requireAdmin(req);
    const b = CardCreate.parse(req.body);
    const card = await tx(async (c) => {
      const s = await c.query("SELECT 1 FROM card_sets WHERE id=$1", [b.setId]);
      if (!s.rowCount) fail("NOT_FOUND", "Set not found");
      const r = await c.query(
        "INSERT INTO cards (set_id, name, faze_member, rarity, art_url, base_power, max_supply) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [b.setId, b.name.trim(), b.fazeMember.trim(), b.rarity, b.artUrl, b.basePower, b.maxSupply ?? null],
      );
      await c.query("INSERT INTO card_stats (card_id, hype) VALUES ($1, 0) ON CONFLICT DO NOTHING", [r.rows[0].id]);
      return r.rows[0];
    });
    return reply.status(201).send({ card: toCard(card) });
  });

  app.patch("/admin/cards/:id", async (req) => {
    requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = CardPatch.parse(req.body ?? {});
    const { cols, vals } = setClause({
      name: b.name?.trim(),
      faze_member: b.fazeMember?.trim(),
      rarity: b.rarity,
      art_url: b.artUrl,
      base_power: b.basePower,
      max_supply: b.maxSupply,
    });
    const r = cols.length
      ? await pool.query(`UPDATE cards SET ${cols.join(", ")} WHERE id=$1 RETURNING *`, [id, ...vals])
      : await pool.query("SELECT * FROM cards WHERE id=$1", [id]);
    if (!r.rowCount) fail("NOT_FOUND", "Card not found");
    return { card: toCard(r.rows[0]) };
  });

  // ---------- packs ----------
  app.get("/admin/packs", async (req) => {
    requireAdmin(req);
    const r = await pool.query("SELECT * FROM packs ORDER BY name");
    return { packs: r.rows.map(toPack) };
  });

  app.post("/admin/packs", async (req, reply) => {
    requireAdmin(req);
    const b = PackCreate.parse(req.body);
    checkOdds(b.odds);
    const s = await pool.query("SELECT 1 FROM card_sets WHERE id=$1", [b.setId]);
    if (!s.rowCount) fail("NOT_FOUND", "Set not found");
    const r = await pool.query(
      "INSERT INTO packs (set_id, name, price_coins, cards_per_pack, odds, odds_version) VALUES ($1,$2,$3,$4,$5,1) RETURNING *",
      [b.setId, b.name.trim(), b.priceCoins, b.cardsPerPack, b.odds],
    );
    return reply.status(201).send({ pack: toPack(r.rows[0]) });
  });

  app.patch("/admin/packs/:id", async (req) => {
    requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = PackPatch.parse(req.body ?? {});
    if (b.odds) checkOdds(b.odds);
    const { cols, vals } = setClause({
      name: b.name?.trim(),
      price_coins: b.priceCoins,
      cards_per_pack: b.cardsPerPack,
      odds: b.odds,
      active: b.active,
    });
    if (b.odds) cols.push("odds_version = odds_version + 1");
    const r = cols.length
      ? await pool.query(`UPDATE packs SET ${cols.join(", ")} WHERE id=$1 RETURNING *`, [id, ...vals])
      : await pool.query("SELECT * FROM packs WHERE id=$1", [id]);
    if (!r.rowCount) fail("NOT_FOUND", "Pack not found");
    return { pack: toPack(r.rows[0]) };
  });

  // ---------- moderation ----------
  app.get("/admin/moderation", async (req) => {
    requireAdmin(req);
    const q = z.object({ status: ModerationStatus.default("pending") }).parse(req.query ?? {});
    const r = await pool.query("SELECT * FROM submissions WHERE status=$1 ORDER BY created_at", [q.status]);
    return { submissions: r.rows.map(toSubmission) };
  });

  app.post("/admin/moderation/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const { decision } = ModerationDecisionBody.parse(req.body);
    const status = decision === "approve" ? "approved" : "rejected";
    const sub = await tx(async (c) => {
      const s = await c.query("SELECT * FROM submissions WHERE id=$1 FOR UPDATE", [id]);
      if (!s.rowCount) fail("NOT_FOUND", "Submission not found");
      if (s.rows[0].status !== "pending") fail("CONFLICT", `Already ${s.rows[0].status}`);
      const u = await c.query(
        "UPDATE submissions SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 RETURNING *",
        [id, status, admin.sub],
      );
      const row = u.rows[0];
      if (row.kind === "display_name") {
        await c.query("UPDATE users SET display_name_status=$2 WHERE id=$1", [row.ref_id ?? row.user_id, status]);
      } else if (row.kind === "trade_message" && row.ref_id) {
        await c.query("UPDATE trades SET message_status=$2 WHERE id=$1", [row.ref_id, status]);
      }
      return row;
    });
    return { submission: toSubmission(sub) };
  });

  // ---------- engagement ----------
  app.post("/admin/engagement/spike", async (req, reply) => {
    requireAdmin(req);
    const b = SpikeBody.parse(req.body);
    if (!b.fazeMember.trim()) fail("VALIDATION", "fazeMember required");
    const r = await pool.query("INSERT INTO jobs (kind, payload) VALUES ('engagement_spike', $1) RETURNING id", [
      { fazeMember: b.fazeMember.trim() },
    ]);
    return reply.status(201).send({ jobId: r.rows[0].id });
  });
}
