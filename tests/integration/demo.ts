// Real API + payment HTTP boundaries, durable SQL storage, explicitly simulated chain.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to an isolated Tiger Cloud test database. No production fallback.');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'integration-test-jwt';
process.env.INTERNAL_SECRET ||= 'integration-test-internal';
const { buildApp: apiApp } = await import('../../services/api/src/app.js');
const { pool } = await import('../../services/api/src/db.js');
const { migrate } = await import('../../services/api/src/migrate.js');
const { signSession } = await import('../../services/api/src/auth.js');
const { buildApp: paymentApp } = await import('../../services/payments/src/app.js');
const { pgRepo } = await import('../../services/payments/src/repo.js');
const { httpLedger } = await import('../../services/payments/src/ledger.js');
const { simulatedReader } = await import('../../services/payments/src/solana.js');
await migrate();
const api = await apiApp();
await api.listen({ port: 0, host: '127.0.0.1' });
const address = api.server.address();
assert.ok(address && typeof address === 'object');
const treasury = '11111111111111111111111111111112';
const payments = paymentApp({ repo: pgRepo(pool), ledger: httpLedger(`http://127.0.0.1:${address.port}`, process.env.INTERNAL_SECRET), chain: simulatedReader(treasury, 'devnet'), treasury, jwtSecret: process.env.JWT_SECRET, clientUrl: 'http://localhost:3000' });
const marker = randomUUID();
async function request(app: any, method: any, url: string, cookie?: string, payload?: any, expected = 200) {
 const res = await app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
 assert.equal(res.statusCode, expected, `${method} ${url}: ${res.body}`);
 return res.json();
}
async function signup(name: string) {
 const res = await api.inject({ method: 'POST', url: '/auth/signup', payload: { email: `${name}-${marker}@integration.test`, password: 'integration-password', displayName: name } });
 assert.equal(res.statusCode, 201);
 const raw = res.headers['set-cookie'];
 return { id: res.json().user.id, cookie: String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] };
}
try {
 const a = await signup('DemoOne'); const b = await signup('DemoTwo');
 assert.equal((await request(api, 'GET', '/me', a.cookie)).balance, 500);
 const admin = await pool.query("INSERT INTO users(email,password_hash,display_name,role,demo) VALUES($1,'test','Integration admin','admin',true) RETURNING id", [`admin-${marker}@integration.test`]);
 const adminCookie = `session=${signSession(admin.rows[0].id, 'admin')}`;
 await request(api, 'GET', '/admin/sets', a.cookie, undefined, 403);
 const set = (await request(api, 'POST', '/admin/sets', adminCookie, { name: `Demo ${marker}`, description: 'Integration demo' }, 201)).set;
 await request(api, 'POST', '/admin/cards', adminCookie, { setId: set.id, name: 'Demo card', fazeMember: 'Demo Member', rarity: 'common', artUrl: 'https://example.test/demo.svg', basePower: 10 }, 201);
 const pack = (await request(api, 'POST', '/admin/packs', adminCookie, { setId: set.id, name: 'Demo pack', priceCoins: 100, cardsPerPack: 5, odds: { common: 100 } }, 201)).pack;
 await request(api, 'POST', `/admin/sets/${set.id}/publish`, adminCookie);
 assert.ok((await request(api, 'GET', '/packs')).packs.some((p: any) => p.id === pack.id));
 const pullA = await request(api, 'POST', `/packs/${pack.id}/open`, a.cookie, { idempotencyKey: randomUUID() });
 const pullB = await request(api, 'POST', `/packs/${pack.id}/open`, b.cookie, { idempotencyKey: randomUUID() });
 assert.equal(pullA.balance, 400); assert.equal(pullA.cards.length, 5);
 const checkout = await request(payments, 'POST', '/payments/checkout', a.cookie, { bundleId: 'coins_1000' });
 const payment = { purchaseId: checkout.purchaseId, signature: `sim_${checkout.reference}_${checkout.lamports}` };
 const confirmations = await Promise.all([request(payments, 'POST', '/payments/confirm', a.cookie, payment), request(payments, 'POST', '/payments/confirm', a.cookie, payment)]);
 assert.ok(confirmations.every(p => p.balance === 1400));
 assert.equal((await request(api, 'GET', '/me', a.cookie)).balance, 1400);
 const trade = (await request(api, 'POST', '/trades', a.cookie, { toUserId: b.id, offeredInstanceIds: [pullA.cards[0].id], requestedInstanceIds: [pullB.cards[0].id], message: 'Demo trade' }, 201)).trade;
 assert.equal((await request(api, 'GET', '/me/trades', b.cookie)).incoming[0].message, null);
 const submissions = (await request(api, 'GET', '/admin/moderation?status=pending', adminCookie)).submissions;
 const submission = submissions.find((s: any) => s.refId === trade.id);
 await request(api, 'POST', `/admin/moderation/${submission.id}`, adminCookie, { decision: 'approve' });
 assert.equal((await request(api, 'GET', '/me/trades', b.cookie)).incoming[0].message, 'Demo trade');
 await request(api, 'POST', `/trades/${trade.id}/accept`, b.cookie);
 await request(api, 'POST', `/trades/${trade.id}/accept`, b.cookie, undefined, 409);
 const owned = (await request(api, 'GET', '/me/cards', a.cookie)).cards.flatMap((c: any) => c.instances.map((i: any) => i.id));
 assert.ok(owned.includes(pullB.cards[0].id)); assert.ok(!owned.includes(pullA.cards[0].id));
 assert.ok((await request(api, 'GET', '/leaderboard')).collectors.length >= 2);
 console.log('PASS: demo signup, packs, simulated Solana payment/replay, moderation, trade, collection, leaderboard.');
} finally { await payments.close(); await api.close(); await pool.end(); }
