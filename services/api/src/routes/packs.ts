import { mintPack, loadInstances } from '../pack-mint.js';
import { packPriceLamports } from '../pack-payment.js';
import { randomUUID } from "node:crypto";
import { OpenPackBody, type Pack } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { balanceOf, lockUser, postEntry } from "../ledger.js";
import { toCard } from "../mappers.js";
import { pickCard, rollRarity, type CardSlot } from "../pulls.js";

export function toPack(r: any): Pack {
  return {
    id: r.id,
    name: r.name,
    setId: r.set_id,
    priceCoins: r.price_coins,
    priceLamports: packPriceLamports(r.price_coins),
    cardsPerPack: r.cards_per_pack,
    odds: r.odds,
    oddsVersion: r.odds_version,
  };
}

export async function packsRoutes(app: FastifyInstance) {
  app.get("/packs", async () => {
    const r = await pool.query(
      `SELECT p.* FROM packs p JOIN card_sets s ON s.id = p.set_id
        WHERE p.active AND s.status = 'live' ORDER BY p.price_coins, p.name`,
    );
    return { packs: r.rows.map(toPack) };
  });

  app.post<{ Params: { id: string } }>("/packs/:id/open", async (req) => {
    const s = requireUser(req);
    const { idempotencyKey } = OpenPackBody.parse(req.body);
    const ledgerKey = `pack_open:${s.sub}:${idempotencyKey}`;

    return tx(async (c) => {
      await lockUser(c, s.sub);

      // Replay: same key → same pull, no new debit.
      const prior = await c.query("SELECT ref_id FROM ledger WHERE idempotency_key=$1", [ledgerKey]);
      if (prior.rowCount) {
        const pull = await c.query("SELECT * FROM pulls WHERE id=$1", [prior.rows[0].ref_id]);
        return {
          pullId: pull.rows[0].id,
          cards: await loadInstances(c, pull.rows[0].card_instance_ids),
          balance: await balanceOf(c, s.sub),
        };
      }

      const pr = await c.query(
        `SELECT p.* FROM packs p JOIN card_sets s ON s.id = p.set_id
          WHERE p.id=$1 AND p.active AND s.status='live'`,
        [req.params.id],
      );
      const pack = pr.rows[0] ?? fail("NOT_FOUND", "Pack not found");
      const bal = await balanceOf(c, s.sub);
      if (bal < pack.price_coins) fail("INSUFFICIENT_COINS", `Need ${pack.price_coins} coins, have ${bal}`);

      const {pullId,instanceIds} = await mintPack(c,s.sub,pack);
      const debit = await postEntry(c, {
        userId: s.sub,
        amount: -pack.price_coins,
        reason: "pack_open",
        refId: pullId,
        idempotencyKey: ledgerKey,
      });
      return { pullId, cards: await loadInstances(c, instanceIds), balance: debit.balance };
    });
  });
}
