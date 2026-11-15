import { randomUUID } from 'node:crypto';
import type { CardInstance } from '@faze/shared';
import type pg from 'pg';
import { toCard } from './mappers.js';
import { fail } from './errors.js';
import { pickCard, rollRarity, type CardSlot } from './pulls.js';
export async function loadInstances(db: pg.PoolClient | pg.Pool, ids: string[]): Promise<CardInstance[]> {
    const r = await db.query(`SELECT ci.id AS ci_id, ci.serial, ci.locked_by_trade_id, ci.market_listing_id, ci.market_offer_id, ci.acquired_at, c.*
       FROM card_instances ci JOIN cards c ON c.id = ci.card_id WHERE ci.id = ANY($1::uuid[])`, [ids]);
    const byId = new Map(r.rows.map((row) => [row.ci_id, row]));
    return ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((row) => ({
        id: row.ci_id,
        card: toCard(row),
        serial: row.serial,
        locked: row.locked_by_trade_id !== null || row.market_listing_id !== null || row.market_offer_id !== null,
        acquiredAt: new Date(row.acquired_at).toISOString(),
    }));
}
export async function mintPack(c: pg.PoolClient, userId: string, pack: any) {
    // Lock every card in the set (stable order) FIRST, then read supply/serials in a new statement:
    // under READ COMMITTED a statement that waited on the lock still uses its pre-wait snapshot for
    // subqueries, which would miss instances minted by the transaction we waited on (found by @tanejakeshav).
    await c.query("SELECT id FROM cards WHERE set_id=$1 ORDER BY id FOR UPDATE", [pack.set_id]);
    const cr = await c.query(`SELECT c.id, c.rarity, c.max_supply,
                (SELECT COUNT(*) FROM card_instances ci WHERE ci.card_id=c.id)::int AS minted,
                (SELECT COALESCE(MAX(serial),0) FROM card_instances ci WHERE ci.card_id=c.id)::int AS max_serial
           FROM cards c WHERE c.set_id=$1 ORDER BY c.id`, [pack.set_id]);
    const slots: CardSlot[] = cr.rows.map((r) => ({ id: r.id, rarity: r.rarity, maxSupply: r.max_supply, minted: r.minted }));
    const nextSerial = new Map<string, number>(cr.rows.map((r) => [r.id, r.max_serial]));
    const picks: string[] = [];
    for (let i = 0; i < pack.cards_per_pack; i++) {
        const card = pickCard(slots, rollRarity(pack.odds));
        if (!card)
            fail("CONFLICT", "This pack is sold out");
        picks.push(card.id);
    }
    const pullId = randomUUID();
    const instanceIds: string[] = [];
    for (const cardId of picks) {
        const serial = nextSerial.get(cardId)! + 1;
        nextSerial.set(cardId, serial);
        const ins = await c.query("INSERT INTO card_instances (card_id, owner_id, serial) VALUES ($1,$2,$3) RETURNING id", [cardId, userId, serial]);
        instanceIds.push(ins.rows[0].id);
    }
    await c.query("INSERT INTO pulls (id, user_id, pack_id, odds_version, card_instance_ids) VALUES ($1,$2,$3,$4,$5)", [pullId, userId, pack.id, pack.odds_version, instanceIds]);
    return { pullId, instanceIds, cards: await loadInstances(c, instanceIds) };
}
