import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { fail } from '../errors.js';
import { toCard, toPublicUser } from '../mappers.js';
const Id = z.object({ id: z.string().uuid() });
async function instances(db: pg.Pool | pg.PoolClient, ids: string[]) {
    const r = await db.query(`SELECT c.*,i.id AS instance_id,i.serial FROM card_instances i JOIN cards c ON c.id=i.card_id WHERE i.id=ANY($1::uuid[])`, [ids]);
    const map = new Map(r.rows.map(r => [r.instance_id, { id: r.instance_id, serial: r.serial, card: toCard(r) }]));
    return ids.map(id => map.get(id));
}
async function renderListings(db: pg.Pool | pg.PoolClient, rows: any[]) {
    return Promise.all(rows.map(async (r) => ({ id: r.id, owner_id: r.owner_id, instance_id: r.instance_id, status: r.status, created_at: r.created_at, resolved_at: r.resolved_at, owner: { ...toPublicUser(r), id: r.owner_id }, instance: (await instances(db, [r.instance_id]))[0] })));
}
async function notify(c: pg.PoolClient, userId: string, kind: string, message: string, offerId: string) {
    await c.query('INSERT INTO notifications(user_id,kind,message,offer_id) VALUES($1,$2,$3,$4)', [userId, kind, message, offerId]);
}
async function closeOffers(c: pg.PoolClient, listingId: string, acceptedId?: string) {
    const losers = await c.query("UPDATE market_offers SET status='declined',resolved_at=now() WHERE listing_id=$1 AND status='open' AND ($2::uuid IS NULL OR id<>$2) RETURNING *", [listingId, acceptedId ?? null]);
    for (const o of losers.rows) {
        await c.query('UPDATE card_instances SET market_offer_id=NULL WHERE market_offer_id=$1', [o.id]);
        await notify(c, o.bidder_id, 'offer_closed', 'An offer closed because its listing is no longer available.', o.id);
    }
}
export async function marketplaceRoutes(app: FastifyInstance) {
    app.get('/marketplace/listings', async (req) => {
        const q = z.object({ q: z.string().max(100).default(''), rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
        const r = await pool.query(`SELECT l.*,u.id AS id_user,u.display_name,u.display_name_status FROM market_listings l JOIN users u ON u.id=l.owner_id JOIN card_instances i ON i.id=l.instance_id JOIN cards c ON c.id=i.card_id WHERE l.status='open' AND ($1='' OR c.name ILIKE '%'||$1||'%' ESCAPE '\\' OR c.faze_member ILIKE '%'||$1||'%' ESCAPE '\\') AND ($2::text IS NULL OR c.rarity=$2) ORDER BY l.created_at DESC,l.id LIMIT 25 OFFSET $3`, [q.q.replace(/[\\%_]/g, (ch) => '\\' + ch), q.rarity ?? null, (q.page - 1) * 25]);
        return { listings: await renderListings(pool, r.rows) };
    });
    app.post('/marketplace/listings', async (req, reply) => {
        const u = requireUser(req), b = z.object({ instanceId: z.string().uuid() }).parse(req.body);
        const listing = await tx(async (c) => { const r = await c.query('SELECT * FROM card_instances WHERE id=$1 FOR UPDATE', [b.instanceId]); const i = r.rows[0]; if (!i || i.owner_id !== u.sub)
            fail('NOT_FOUND', 'Card not found in your collection'); if (i.locked_by_trade_id || i.market_listing_id || i.market_offer_id)
            fail('CARD_LOCKED', 'Card already committed to a trade'); const l = (await c.query('INSERT INTO market_listings(owner_id,instance_id) VALUES($1,$2) RETURNING *', [u.sub, i.id])).rows[0]; await c.query('UPDATE card_instances SET market_listing_id=$1 WHERE id=$2', [l.id, i.id]); return l; });
        return reply.code(201).send({ listing });
    });
    app.post('/marketplace/listings/:id/cancel', async (req) => {
        const u = requireUser(req), { id } = Id.parse(req.params);
        await tx(async (c) => { const l = (await c.query('SELECT * FROM market_listings WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!l)
            fail('NOT_FOUND', 'Listing not found'); if (l.owner_id !== u.sub)
            fail('FORBIDDEN', 'Not your listing'); if (l.status !== 'open')
            fail('CONFLICT', 'Listing already closed'); await closeOffers(c, id); await c.query('UPDATE card_instances SET market_listing_id=NULL WHERE market_listing_id=$1', [id]); await c.query("UPDATE market_listings SET status='cancelled',resolved_at=now() WHERE id=$1", [id]); });
        return { ok: true };
    });
    app.post('/marketplace/listings/:id/offers', async (req, reply) => {
        const u = requireUser(req), { id } = Id.parse(req.params), b = z.object({ instanceIds: z.array(z.string().uuid()).min(1).max(20) }).parse(req.body);
        if (new Set(b.instanceIds).size !== b.instanceIds.length)
            fail('VALIDATION', 'Duplicate cards');
        const offer = await tx(async (c) => { const l = (await c.query('SELECT * FROM market_listings WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!l || l.status !== 'open')
            fail('CONFLICT', 'Listing unavailable'); if (l.owner_id === u.sub)
            fail('VALIDATION', 'Cannot offer on your own listing'); const cards = await c.query('SELECT * FROM card_instances WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [b.instanceIds]); if (cards.rowCount !== b.instanceIds.length || cards.rows.some(i => i.owner_id !== u.sub))
            fail('NOT_FOUND', 'Offered cards must belong to you'); if (cards.rows.some(i => i.locked_by_trade_id || i.market_listing_id || i.market_offer_id))
            fail('CARD_LOCKED', 'An offered card is already committed'); const o = (await c.query('INSERT INTO market_offers(listing_id,bidder_id,offered_instance_ids) VALUES($1,$2,$3) RETURNING *', [id, u.sub, b.instanceIds])).rows[0]; await c.query('UPDATE card_instances SET market_offer_id=$1 WHERE id=ANY($2::uuid[])', [o.id, b.instanceIds]); await notify(c, l.owner_id, 'offer_received', 'You received an exchange offer on your card.', o.id); return o; });
        return reply.code(201).send({ offer });
    });
    app.get('/me/marketplace', async (req) => {
        const u = requireUser(req);
        const offers = await pool.query(`SELECT o.*,l.owner_id,l.instance_id,l.status AS listing_status,u.display_name,u.display_name_status FROM market_offers o JOIN market_listings l ON l.id=o.listing_id JOIN users u ON u.id=o.bidder_id WHERE o.bidder_id=$1 OR l.owner_id=$1 ORDER BY o.created_at DESC LIMIT 200`, [u.sub]);
        const out = await Promise.all(offers.rows.map(async (o) => ({ ...Object.fromEntries(Object.entries(o).filter(([key]) => !['display_name', 'display_name_status'].includes(key))), owner_id: o.owner_id, bidder_id: o.bidder_id, bidder: { ...toPublicUser(o), id: o.bidder_id }, listed: (await instances(pool, [o.instance_id]))[0], offered: await instances(pool, o.offered_instance_ids) })));
        const listings = await pool.query(`SELECT l.*,u.display_name,u.display_name_status FROM market_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id=$1 ORDER BY l.created_at DESC LIMIT 100`, [u.sub]);
        return { incoming: out.filter(o => o.owner_id === u.sub), outgoing: out.filter(o => o.bidder_id === u.sub), listings: await renderListings(pool, listings.rows) };
    });
    for (const action of ['accept', 'decline', 'withdraw'] as const)
        app.post('/marketplace/offers/:id/' + action, async (req) => {
            const u = requireUser(req), { id } = Id.parse(req.params);
            await tx(async (c) => {
                const ref = (await c.query('SELECT listing_id FROM market_offers WHERE id=$1', [id])).rows[0];
                if (!ref)
                    fail('NOT_FOUND', 'Offer not found');
                const l = (await c.query('SELECT * FROM market_listings WHERE id=$1 FOR UPDATE', [ref.listing_id])).rows[0];
                const offers = await c.query('SELECT * FROM market_offers WHERE listing_id=$1 ORDER BY id FOR UPDATE', [l.id]);
                const o = offers.rows.find(o => o.id === id)!;
                if ((action === 'withdraw' ? o.bidder_id : l.owner_id) !== u.sub)
                    fail('FORBIDDEN', 'You cannot perform this action');
                if (o.status !== 'open' || l.status !== 'open')
                    fail('TRADE_NOT_OPEN', 'Offer already closed');
                if (action === 'accept') {
                    const all = [l.instance_id, ...offers.rows.filter(x => x.status === 'open').flatMap(x => x.offered_instance_ids)];
                    const rows = await c.query('SELECT * FROM card_instances WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [all]);
                    const listed = rows.rows.find(i => i.id === l.instance_id);
                    if (!listed || listed.owner_id !== l.owner_id || listed.market_listing_id !== l.id || listed.locked_by_trade_id || listed.market_offer_id)
                        fail('CONFLICT', 'Listed card is unavailable');
                    for (const iid of o.offered_instance_ids) {
                        const i = rows.rows.find(i => i.id === iid);
                        if (!i || i.owner_id !== o.bidder_id || i.market_offer_id !== o.id || i.locked_by_trade_id || i.market_listing_id)
                            fail('CONFLICT', 'Offered cards unavailable');
                    }
                    await c.query('UPDATE card_instances SET owner_id=$1,market_listing_id=NULL,acquired_at=now() WHERE id=$2', [o.bidder_id, l.instance_id]);
                    await c.query('UPDATE card_instances SET owner_id=$1,market_offer_id=NULL,acquired_at=now() WHERE id=ANY($2::uuid[])', [l.owner_id, o.offered_instance_ids]);
                    await c.query("UPDATE market_offers SET status='accepted',resolved_at=now() WHERE id=$1", [o.id]);
                    await closeOffers(c, l.id, o.id);
                    await c.query("UPDATE market_listings SET status='completed',resolved_at=now() WHERE id=$1", [l.id]);
                    for (const uid of [l.owner_id, o.bidder_id])
                        await notify(c, uid, 'trade_completed', 'Exchange completed! Your new cards are in your collection.', o.id);
                }
                else {
                    await c.query('UPDATE card_instances SET market_offer_id=NULL WHERE market_offer_id=$1', [o.id]);
                    await c.query('UPDATE market_offers SET status=$2,resolved_at=now() WHERE id=$1', [o.id, action === 'decline' ? 'declined' : 'withdrawn']);
                    await notify(c, action === 'decline' ? o.bidder_id : l.owner_id, 'offer_closed', action === 'decline' ? 'Your exchange offer was declined.' : 'An exchange offer was withdrawn.', o.id);
                }
            });
            return { ok: true };
        });
    app.get('/me/notifications', async (req) => { const u = requireUser(req); return { notifications: (await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [u.sub])).rows }; });
    app.post('/me/notifications/:id/read', async (req) => { const u = requireUser(req), { id } = Id.parse(req.params); const r = await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id', [id, u.sub]); if (!r.rowCount)
        fail('NOT_FOUND', 'Notification not found'); return { ok: true }; });
}
