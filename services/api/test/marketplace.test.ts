import { beforeAll, afterAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, makeSetWithPack, pool, signup } from './helpers.js';
let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await pool.end(); });
async function card(owner: string) { const { cardIds } = await makeSetWithPack(); return (await pool.query('INSERT INTO card_instances(card_id,owner_id,serial) VALUES($1,$2,1) RETURNING id', [cardIds[0], owner])).rows[0].id as string; }
async function post(url: string, cookie: string, body: unknown = {}, status = 200) { const r = await app.inject({ method: 'POST', url, headers: { cookie }, payload: body as object }); expect(r.statusCode, r.body).toBe(status); return r.json(); }
async function setup() { const seller = await signup(app, 'Private Seller'), a = await signup(app, 'Bidder A'), b = await signup(app, 'Bidder B'); const listed = await card(seller.id), ai = await card(a.id), bi = await card(b.id); const l = (await post('/marketplace/listings', seller.cookie, { instanceId: listed }, 201)).listing; return { seller, a, b, listed, ai, bi, l }; }
it('public browsing hides unapproved names, reserves inventory and prevents direct-trade bypass', async () => {
    const s = await setup();
    const browse = (await app.inject('/marketplace/listings')).json().listings;
    const item = browse.find((l: any) => l.id === s.l.id);
    expect(item.owner).toEqual({ id: s.seller.id, displayName: 'New collector' });
    expect(item.display_name).toBeUndefined();
    expect(item.instance.id).toBe(s.listed);
    await post('/marketplace/listings', s.a.cookie, { instanceId: s.listed }, 404);
    await post('/marketplace/listings', s.seller.cookie, { instanceId: s.listed }, 409);
    await post(`/marketplace/listings/${s.l.id}/offers`, s.seller.cookie, { instanceIds: [s.listed] }, 400);
    await post('/trades', s.seller.cookie, { toUserId: s.a.id, offeredInstanceIds: [s.listed], requestedInstanceIds: [s.ai] }, 409);
    const own = (await app.inject({ url: '/me/cards', headers: { cookie: s.seller.cookie } })).json();
    expect(own.cards.some((c: any) => c.instances.some((i: any) => i.id === s.listed && i.locked))).toBe(true);
});
it('search treats % and _ literally instead of as LIKE wildcards', async () => {
    await setup();
    for (const q of ['%', '_', '%25%', '\\']) {
        const r = await app.inject(`/marketplace/listings?q=${encodeURIComponent(q)}`);
        expect(r.statusCode).toBe(200);
        expect(r.json().listings).toEqual([]);
    }
});
it('concurrent accepts choose one winner, swap exact copies, release losing bids and notify both owners exactly once', async () => {
    const s = await setup();
    const oa = (await post(`/marketplace/listings/${s.l.id}/offers`, s.a.cookie, { instanceIds: [s.ai] }, 201)).offer;
    const ob = (await post(`/marketplace/listings/${s.l.id}/offers`, s.b.cookie, { instanceIds: [s.bi] }, 201)).offer;
    await post(`/marketplace/offers/${oa.id}/accept`, s.a.cookie, {}, 403);
    const responses = await Promise.all([oa, ob].map(o => app.inject({ method: 'POST', url: `/marketplace/offers/${o.id}/accept`, headers: { cookie: s.seller.cookie }, payload: {} })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const winner = responses[0].statusCode === 200 ? s.a : s.b, won = responses[0].statusCode === 200 ? s.ai : s.bi, lost = responses[0].statusCode === 200 ? s.bi : s.ai;
    const r = await pool.query('SELECT * FROM card_instances WHERE id=ANY($1::uuid[])', [[s.listed, s.ai, s.bi]]);
    expect(r.rows.find(i => i.id === s.listed).owner_id).toBe(winner.id);
    expect(r.rows.find(i => i.id === won).owner_id).toBe(s.seller.id);
    expect(r.rows.find(i => i.id === lost).market_offer_id).toBeNull();
    expect(r.rows.every(i => !i.market_listing_id && !i.market_offer_id)).toBe(true);
    const col = (await app.inject({ url: '/me/cards', headers: { cookie: s.seller.cookie } })).json().cards.flatMap((c: any) => c.instances.map((i: any) => i.id));
    expect(col).toContain(won);
    expect(col).not.toContain(s.listed);
    const notices = await pool.query("SELECT * FROM notifications WHERE kind='trade_completed' AND user_id=ANY($1::uuid[])", [[s.seller.id, winner.id]]);
    expect(notices.rowCount).toBe(2);
    await post(`/me/notifications/${notices.rows[0].id}/read`, s.b.cookie, {}, notices.rows[0].user_id === s.b.id ? 200 : 404);
    const publicItems = (await app.inject('/marketplace/listings')).json().listings;
    expect(publicItems.some((l: any) => l.id === s.l.id)).toBe(false);
});
it('withdrawal, decline and listing cancellation release cards and cannot be performed by strangers', async () => {
    const s = await setup();
    const oa = (await post(`/marketplace/listings/${s.l.id}/offers`, s.a.cookie, { instanceIds: [s.ai] }, 201)).offer;
    await post(`/marketplace/listings/${s.l.id}/offers`, s.b.cookie, { instanceIds: [s.ai] }, 404);
    await post(`/marketplace/listings/${s.l.id}/offers`, s.a.cookie, { instanceIds: [s.ai] }, 409);
    await post(`/marketplace/offers/${oa.id}/withdraw`, s.b.cookie, {}, 403);
    await post(`/marketplace/offers/${oa.id}/withdraw`, s.a.cookie);
    expect((await pool.query('SELECT market_offer_id FROM card_instances WHERE id=$1', [s.ai])).rows[0].market_offer_id).toBeNull();
    const again = (await post(`/marketplace/listings/${s.l.id}/offers`, s.a.cookie, { instanceIds: [s.ai] }, 201)).offer;
    await post(`/marketplace/offers/${again.id}/decline`, s.seller.cookie);
    await post(`/marketplace/listings/${s.l.id}/offers`, s.b.cookie, { instanceIds: [s.bi] }, 201);
    await post(`/marketplace/listings/${s.l.id}/cancel`, s.a.cookie, {}, 403);
    await post(`/marketplace/listings/${s.l.id}/cancel`, s.seller.cookie);
    const locks = await pool.query('SELECT * FROM card_instances WHERE id=ANY($1::uuid[])', [[s.listed, s.ai, s.bi]]);
    expect(locks.rows.every(i => !i.market_offer_id && !i.market_listing_id)).toBe(true);
});
it('multi-card offers transfer every copy and reject mixed ownership without reserving valid copies', async () => {
 const s=await setup(); const extra=await card(s.a.id);
 await post(`/marketplace/listings/${s.l.id}/offers`,s.a.cookie,{instanceIds:[s.ai,s.bi]},404);
 expect((await pool.query('SELECT market_offer_id FROM card_instances WHERE id=$1',[s.ai])).rows[0].market_offer_id).toBeNull();
 const offer=(await post(`/marketplace/listings/${s.l.id}/offers`,s.a.cookie,{instanceIds:[s.ai,extra]},201)).offer;
 await post(`/marketplace/offers/${offer.id}/accept`,s.seller.cookie);
 const received=await pool.query('SELECT id FROM card_instances WHERE owner_id=$1 AND id=ANY($2::uuid[])',[s.seller.id,[s.ai,extra]]);expect(received.rowCount).toBe(2);
 await post(`/marketplace/offers/${offer.id}/accept`,s.seller.cookie,{},409);
 expect((await pool.query("SELECT id FROM notifications WHERE offer_id=$1 AND kind='trade_completed'",[offer.id])).rowCount).toBe(2);
});
