import { randomInt, randomUUID } from 'node:crypto';
import type { CardInstance } from '@faze/shared';
import type pg from 'pg';
import { toCard } from './mappers.js';
import { fail } from './errors.js';
import { pickCard, rollRarity, type CardSlot } from './pulls.js';
export async function loadInstances(db: pg.PoolClient | pg.Pool, ids: string[]): Promise<CardInstance[]> {
    const r = await db.query(`SELECT ci.id AS ci_id, ci.serial, ci.locked_by_trade_id, ci.market_listing_id, ci.market_offer_id, ci.locked_by_game_match_id, ci.acquired_at, c.*
       FROM card_instances ci JOIN cards c ON c.id = ci.card_id WHERE ci.id = ANY($1::uuid[])`, [ids]);
    const byId = new Map(r.rows.map((row) => [row.ci_id, row]));
    return ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((row) => ({
        id: row.ci_id,
        card: toCard(row),
        serial: row.serial,
        locked: row.locked_by_trade_id !== null || row.market_listing_id !== null || row.market_offer_id !== null || row.locked_by_game_match_id !== null,
        acquiredAt: new Date(row.acquired_at).toISOString(),
    }));
}
type FixedSlot = { slot: number; label?: string; cardIds: string[] };

/**
 * Mints a pack. Packs with `fixed_slots` (the demo packs) guarantee specific slots, e.g. card 4 = silver, card 5 = gold:
 * the SERVER still chooses which card with a CSPRNG, and the guarantees are published with the pack (toPack().guaranteed).
 * Cards in a pack's guaranteed lists are kept out of its random slots, and random slots cap at epic (the legendary
 * chance is folded into epic) so the last two cards stay the climax. Instances come back in slot order.
 */
export async function mintPack(c: pg.PoolClient, userId: string, pack: any) {
    const fixed: FixedSlot[] = Array.isArray(pack.fixed_slots) ? pack.fixed_slots : [];
    const fixedIds = [...new Set(fixed.flatMap((f) => f.cardIds))];
    // Lock every card involved (stable order) FIRST, then read supply/serials in a new statement:
    // under READ COMMITTED a statement that waited on the lock still uses its pre-wait snapshot for
    // subqueries, which would miss instances minted by the transaction we waited on (found by @tanejakeshav).
    await c.query("SELECT id FROM cards WHERE set_id=$1 OR id = ANY($2::uuid[]) ORDER BY id FOR UPDATE", [pack.set_id, fixedIds]);
    const cr = await c.query(`SELECT c.id, c.set_id, c.rarity, c.max_supply, c.is_live_moment,
                (SELECT COUNT(*) FROM card_instances ci WHERE ci.card_id=c.id)::int AS minted,
                (SELECT COALESCE(MAX(serial),0) FROM card_instances ci WHERE ci.card_id=c.id)::int AS max_serial
           FROM cards c WHERE c.set_id=$1 OR c.id = ANY($2::uuid[]) ORDER BY c.id`, [pack.set_id, fixedIds]);
    const skip = new Set(fixedIds);
    const slots: CardSlot[] = cr.rows
        .filter((r) => r.set_id === pack.set_id && !skip.has(r.id) && !r.is_live_moment)
        .map((r) => ({ id: r.id, rarity: r.rarity, maxSupply: r.max_supply, minted: r.minted }));
    const info = new Map<string, { maxSupply: number | null; minted: number }>(cr.rows.map((r) => [r.id, { maxSupply: r.max_supply, minted: r.minted }]));
    const nextSerial = new Map<string, number>(cr.rows.map((r) => [r.id, r.max_serial]));
    const odds = fixed.length ? { ...pack.odds, epic: (pack.odds.epic ?? 0) + (pack.odds.legendary ?? 0), legendary: 0 } : pack.odds;
    const picks: string[] = [];
    for (let i = 0; i < pack.cards_per_pack; i++) {
        const f = fixed.find((x) => x.slot === i + 1);
        let id: string | undefined;
        if (f) {
            const open = f.cardIds.filter((cid) => { const x = info.get(cid); return !!x && (x.maxSupply === null || x.minted < x.maxSupply); });
            if (open.length) { id = open[randomInt(open.length)]; info.get(id)!.minted++; }
        }
        if (!id) {
            const card = pickCard(slots, rollRarity(odds));
            if (!card) fail("CONFLICT", "This pack is sold out");
            id = card.id;
            // Don't deal the same card twice in one pack when the set is big enough to avoid it (a pack should feel like a mix).
            const at = slots.findIndex((x) => x.id === card.id);
            if (at >= 0 && slots.length > pack.cards_per_pack) slots.splice(at, 1);
        }
        picks.push(id);
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
