// Hype moments (demo): when stream chat spikes, the watch page offers a limited card. The server owns the purchase:
// price, one copy per user, serial number and the coin debit (ledger). The spike itself is detected in the browser from
// public chat, so it only decides when the OFFER appears: it can't make the card cheaper or grant extra copies.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { balanceOf, lockUser, postEntry } from "../ledger.js";
import { toCard } from "../mappers.js";

/** The Call of Duty World Champions card (content/seed/demo-cards), kept out of packs (is_live_moment). */
export const HYPE_CARD_ID = "d0000000-0000-4000-8000-000000002009";
export const HYPE_PRICE_COINS = 100;

const Body = z.object({
  channel: z.string().trim().max(40).default(""),
  hypeScore: z.number().finite().min(0).max(1000).default(0),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

export async function momentsRoutes(app: FastifyInstance) {
  app.get("/moments/hype/offer", async (req) => {
    const s = requireUser(req);
    const card = (await pool.query("SELECT * FROM cards WHERE id=$1", [HYPE_CARD_ID])).rows[0] ?? fail("NOT_FOUND", "The hype card isn't set up yet (run the demo seed)");
    const owned = (await pool.query("SELECT instance_id FROM stream_moment_claims WHERE user_id=$1 AND card_id=$2", [s.sub, HYPE_CARD_ID])).rowCount! > 0;
    return { card: toCard(card), priceCoins: HYPE_PRICE_COINS, owned, balance: await balanceOf(pool, s.sub) };
  });

  app.post("/moments/hype/claim", async (req, reply) => {
    const s = requireUser(req);
    const b = Body.parse(req.body);
    const out = await tx(async (c) => {
      await lockUser(c, s.sub); // serialises this user's claims: one copy, one debit
      const result = async (instanceId: string, replayed: boolean) => {
        const i = (await c.query("SELECT ci.id, ci.serial, c.* FROM card_instances ci JOIN cards c ON c.id=ci.card_id WHERE ci.id=$1", [instanceId])).rows[0];
        return { status: replayed ? 200 : 201, body: { instance: { id: i.id, serial: i.serial }, card: toCard(i), priceCoins: HYPE_PRICE_COINS, balance: await balanceOf(c, s.sub), replayed } };
      };
      const sameKey = (await c.query("SELECT instance_id FROM stream_moment_claims WHERE user_id=$1 AND idempotency_key=$2", [s.sub, b.idempotencyKey])).rows[0];
      if (sameKey) return result(sameKey.instance_id, true);
      if ((await c.query("SELECT 1 FROM stream_moment_claims WHERE user_id=$1 AND card_id=$2", [s.sub, HYPE_CARD_ID])).rowCount) fail("CONFLICT", "You already collected this card");

      const card = (await c.query("SELECT id FROM cards WHERE id=$1 FOR UPDATE", [HYPE_CARD_ID])).rows[0] ?? fail("NOT_FOUND", "The hype card isn't set up yet (run the demo seed)");
      const serial = (await c.query("SELECT COALESCE(MAX(serial),0)::int + 1 AS n FROM card_instances WHERE card_id=$1", [card.id])).rows[0].n;
      const inst = (await c.query("INSERT INTO card_instances (card_id, owner_id, serial, acquired_via) VALUES ($1,$2,$3,'moment') RETURNING id", [card.id, s.sub, serial])).rows[0];
      // Debit last: INSUFFICIENT_COINS aborts the whole transaction, so no card is kept without payment.
      await postEntry(c, { userId: s.sub, amount: -HYPE_PRICE_COINS, reason: "moment_claim", refId: inst.id, idempotencyKey: `moment:${s.sub}:${card.id}`, demo: true });
      await c.query("INSERT INTO stream_moment_claims (user_id, card_id, instance_id, channel, hype_score, idempotency_key, price_coins) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [s.sub, card.id, inst.id, b.channel, b.hypeScore, b.idempotencyKey, HYPE_PRICE_COINS]);
      return result(inst.id, false);
    });
    return reply.code(out.status).send(out.body);
  });
}
