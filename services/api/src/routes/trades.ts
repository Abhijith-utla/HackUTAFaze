import { CreateTradeBody } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { toPublicUser, toTrade } from "../mappers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function render(db: pg.PoolClient | pg.Pool, rows: any[], viewerId: string) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.from_user_id, r.to_user_id]))];
  const u = await db.query("SELECT id, display_name, display_name_status FROM users WHERE id = ANY($1::uuid[])", [ids]);
  const byId = new Map(u.rows.map((r) => [r.id, toPublicUser(r)]));
  return rows.map((r) => toTrade(r, byId.get(r.from_user_id)!, byId.get(r.to_user_id)!, viewerId));
}

async function lockTrade(c: pg.PoolClient, id: string, userId: string) {
  if (!UUID.test(id)) fail("NOT_FOUND", "Trade not found");
  const r = await c.query("SELECT * FROM trades WHERE id=$1 FOR UPDATE", [id]);
  const t = r.rows[0];
  if (!t) fail("NOT_FOUND", "Trade not found");
  if (t.from_user_id !== userId && t.to_user_id !== userId) fail("FORBIDDEN", "Not your trade");
  return t;
}

async function unlock(c: pg.PoolClient, tradeId: string) {
  await c.query("UPDATE card_instances SET locked_by_trade_id = NULL WHERE locked_by_trade_id=$1", [tradeId]);
}

export async function tradesRoutes(app: FastifyInstance) {
  app.post("/trades", async (req, reply) => {
    const s = requireUser(req);
    const b = CreateTradeBody.parse(req.body);
    if (b.toUserId === s.sub) fail("VALIDATION", "Cannot trade with yourself");
    const all = [...b.offeredInstanceIds, ...b.requestedInstanceIds];
    if (!all.length) fail("VALIDATION", "Offer or request at least one card");
    if (new Set(all).size !== all.length) fail("VALIDATION", "Duplicate card instances");
    const message = b.message?.trim() || null;

    const row = await tx(async (c) => {
      const to = await c.query("SELECT id FROM users WHERE id=$1", [b.toUserId]);
      if (!to.rowCount) fail("NOT_FOUND", "Recipient not found");
      const inst = await c.query(
        "SELECT id, owner_id, locked_by_trade_id, market_listing_id, market_offer_id FROM card_instances WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [all],
      );
      const byId = new Map(inst.rows.map((r) => [r.id, r]));
      for (const id of b.offeredInstanceIds) {
        if (byId.get(id)?.owner_id !== s.sub) fail("NOT_FOUND", `You do not own card ${id}`);
      }
      for (const id of b.requestedInstanceIds) {
        if (byId.get(id)?.owner_id !== b.toUserId) fail("NOT_FOUND", `Recipient does not own card ${id}`);
      }
      if (inst.rows.some((r) => r.locked_by_trade_id || r.market_listing_id || r.market_offer_id)) fail("CARD_LOCKED", "A card is already in another trade");
      const t = await c.query(
        `INSERT INTO trades (from_user_id, to_user_id, offered_instance_ids, requested_instance_ids, message, message_status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [s.sub, b.toUserId, b.offeredInstanceIds, b.requestedInstanceIds, message, message ? "pending" : null],
      );
      const trade = t.rows[0];
      await c.query("UPDATE card_instances SET locked_by_trade_id=$1 WHERE id = ANY($2::uuid[])", [trade.id, all]);
      if (message) {
        await c.query(
          "INSERT INTO submissions (user_id, kind, ref_id, payload) VALUES ($1,'trade_message',$2,$3)",
          [s.sub, trade.id, { message }],
        );
      }
      return trade;
    });
    const [trade] = await render(pool, [row], s.sub);
    return reply.status(201).send({ trade });
  });

  app.get("/me/trades", async (req) => {
    const s = requireUser(req);
    const r = await pool.query(
      "SELECT * FROM trades WHERE from_user_id=$1 OR to_user_id=$1 ORDER BY created_at DESC",
      [s.sub],
    );
    const all = await render(pool, r.rows, s.sub);
    return {
      incoming: all.filter((t) => t.toUser.id === s.sub),
      outgoing: all.filter((t) => t.fromUser.id === s.sub),
    };
  });

  app.post<{ Params: { id: string } }>("/trades/:id/accept", async (req) => {
    const s = requireUser(req);
    const row = await tx(async (c) => {
      const t = await lockTrade(c, req.params.id, s.sub);
      if (t.to_user_id !== s.sub) fail("FORBIDDEN", "Only the recipient can accept");
      if (t.status !== "open") fail("TRADE_NOT_OPEN", `Trade is ${t.status}`);
      const ids = [...t.offered_instance_ids, ...t.requested_instance_ids];
      const inst = await c.query(
        "SELECT id, owner_id, locked_by_trade_id FROM card_instances WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      const byId = new Map(inst.rows.map((r) => [r.id, r]));
      const ok = (id: string, owner: string) => {
        const r = byId.get(id);
        return r && r.owner_id === owner && r.locked_by_trade_id === t.id;
      };
      if (
        !t.offered_instance_ids.every((id: string) => ok(id, t.from_user_id)) ||
        !t.requested_instance_ids.every((id: string) => ok(id, t.to_user_id))
      ) {
        fail("CONFLICT", "Cards in this trade changed hands");
      }
      if (t.offered_instance_ids.length) {
        await c.query("UPDATE card_instances SET owner_id=$1, locked_by_trade_id=NULL WHERE id = ANY($2::uuid[])", [
          t.to_user_id,
          t.offered_instance_ids,
        ]);
      }
      if (t.requested_instance_ids.length) {
        await c.query("UPDATE card_instances SET owner_id=$1, locked_by_trade_id=NULL WHERE id = ANY($2::uuid[])", [
          t.from_user_id,
          t.requested_instance_ids,
        ]);
      }
      const u = await c.query("UPDATE trades SET status='accepted', resolved_at=now() WHERE id=$1 RETURNING *", [t.id]);
      return u.rows[0];
    });
    const [trade] = await render(pool, [row], s.sub);
    return { trade };
  });

  for (const action of ["decline", "cancel"] as const) {
    app.post<{ Params: { id: string } }>(`/trades/:id/${action}`, async (req) => {
      const s = requireUser(req);
      const row = await tx(async (c) => {
        const t = await lockTrade(c, req.params.id, s.sub);
        const allowed = action === "decline" ? t.to_user_id : t.from_user_id;
        if (allowed !== s.sub) {
          fail("FORBIDDEN", action === "decline" ? "Only the recipient can decline" : "Only the sender can cancel");
        }
        if (t.status !== "open") fail("TRADE_NOT_OPEN", `Trade is ${t.status}`);
        await unlock(c, t.id);
        const status = action === "decline" ? "declined" : "cancelled";
        const u = await c.query("UPDATE trades SET status=$2, resolved_at=now() WHERE id=$1 RETURNING *", [t.id, status]);
        return u.rows[0];
      });
      const [trade] = await render(pool, [row], s.sub);
      return { trade };
    });
  }
}
