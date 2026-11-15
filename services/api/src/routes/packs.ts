import { randomUUID } from "node:crypto";
import { OpenPackBody, type CardInstance, type Pack } from "@faze/shared";
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
    cardsPerPack: r.cards_per_pack,
    odds: r.odds,
    oddsVersion: r.odds_version,
  };
}

async function loadInstances(db: pg.PoolClient | pg.Pool, ids: string[]): Promise<CardInstance[]> {
  const r = await db.query(
    `SELECT ci.id AS ci_id, ci.serial, ci.locked_by_trade_id, ci.acquired_at, c.*
       FROM card_instances ci JOIN cards c ON c.id = ci.card_id WHERE ci.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(r.rows.map((row) => [row.ci_id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      id: row.ci_id,
      card: toCard(row),
      serial: row.serial,
      locked: row.locked_by_trade_id !== null,
      acquiredAt: new Date(row.acquired_at).toISOString(),
    }));
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

      // Lock every card in the set (stable order) so supply + serials are race-free.
      const cr = await c.query(
        `SELECT c.id, c.rarity, c.max_supply,
                (SELECT COUNT(*) FROM card_instances ci WHERE ci.card_id=c.id)::int AS minted,
                (SELECT COALESCE(MAX(serial),0) FROM card_instances ci WHERE ci.card_id=c.id)::int AS max_serial
           FROM cards c WHERE c.set_id=$1 ORDER BY c.id FOR UPDATE`,
        [pack.set_id],
      );
      const slots: CardSlot[] = cr.rows.map((r) => ({ id: r.id, rarity: r.rarity, maxSupply: r.max_supply, minted: r.minted }));
      const nextSerial = new Map<string, number>(cr.rows.map((r) => [r.id, r.max_serial]));

      const picks: string[] = [];
      for (let i = 0; i < pack.cards_per_pack; i++) {
        const card = pickCard(slots, rollRarity(pack.odds));
        if (!card) fail("CONFLICT", "This pack is sold out");
        picks.push(card.id);
      }

      const pullId = randomUUID();
      const instanceIds: string[] = [];
      for (const cardId of picks) {
        const serial = nextSerial.get(cardId)! + 1;
        nextSerial.set(cardId, serial);
        const ins = await c.query(
          "INSERT INTO card_instances (card_id, owner_id, serial) VALUES ($1,$2,$3) RETURNING id",
          [cardId, s.sub, serial],
        );
        instanceIds.push(ins.rows[0].id);
      }
      await c.query(
        "INSERT INTO pulls (id, user_id, pack_id, odds_version, card_instance_ids) VALUES ($1,$2,$3,$4,$5)",
        [pullId, s.sub, pack.id, pack.odds_version, instanceIds],
      );
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
