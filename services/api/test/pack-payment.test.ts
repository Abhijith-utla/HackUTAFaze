import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { encodeKey, livePackChain, type PackChain, type PackOrder } from '../src/pack-payment.js';
import { fail } from '../src/errors.js';
import { pool, signup, makeSetWithPack } from './helpers.js';
let app: FastifyInstance;
let verifications = 0;
const treasury = '11111111111111111111111111111112';
const payer = encodeKey(Buffer.alloc(32, 7));
const chain: PackChain = { async find() { return 'validReceipt'; }, async verify(_order, signature) { verifications++; if (signature === 'badReceipt')
        fail('VALIDATION', 'Underpaid'); } };
beforeAll(async () => { vi.stubEnv('SOLANA_TREASURY_PUBKEY', treasury); vi.stubEnv('SOLANA_CLUSTER', 'devnet'); vi.stubEnv('PAYMENTS_SIMULATE', '0'); app = await buildApp({ packChain: chain }); await app.ready(); });
afterAll(async () => { await app.close(); await pool.end(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function checkout() { const fan = await signup(app); const pack = await makeSetWithPack(); const key = crypto.randomUUID(); const body = { payerWallet: payer, idempotencyKey: key }; const res = await app.inject({ method: 'POST', url: `/packs/${pack.packId}/checkout`, headers: { cookie: fan.cookie }, payload: body }); expect(res.statusCode, res.body).toBe(201); return { fan, pack, body, order: res.json() }; }
it('server quotes SOL and checkout retries do not create another purchase', async () => { const s = await checkout(); expect(s.order.lamports).toBe(5000000); const again = await app.inject({ method: 'POST', url: `/packs/${s.pack.packId}/checkout`, headers: { cookie: s.fan.cookie }, payload: s.body }); expect(again.json().purchaseId).toBe(s.order.purchaseId); const read = await pool.query('SELECT coins,bundle_id FROM purchases WHERE id=$1', [s.order.purchaseId]); expect(read.rows[0].coins).toBe(0); expect(read.rows[0].bundle_id).toBe('pack:' + s.pack.packId); });
it('concurrent paid confirmation mints one pull, replays the same cards and never credits/debits coins', async () => { const s = await checkout(); const signature = 'unique_' + s.order.purchaseId; const send = () => app.inject({ method: 'POST', url: `/pack-purchases/${s.order.purchaseId}/confirm`, headers: { cookie: s.fan.cookie }, payload: { signature } }); const results = await Promise.all([send(), send()]); expect(results.map(r => r.statusCode)).toEqual([200, 200]); const a = results[0].json(), b = results[1].json(); expect(a.cards).toHaveLength(5); expect(b.pullId).toBe(a.pullId); expect(b.cards.map((c: any) => c.id).sort()).toEqual(a.cards.map((c: any) => c.id).sort()); const balance = (await app.inject({ url: '/me', headers: { cookie: s.fan.cookie } })).json().balance; expect(balance).toBe(500); expect((await pool.query('SELECT id FROM pulls WHERE user_id=$1', [s.fan.id])).rowCount).toBe(1); const other = await signup(app); expect((await app.inject({ method: 'POST', url: `/pack-purchases/${s.order.purchaseId}/confirm`, headers: { cookie: other.cookie }, payload: {} })).statusCode).toBe(404); });
it('bad and previously-used transactions cannot mint; verified pending purchases recover without chain access', async () => {
    const s = await checkout();
    const endpoint = `/pack-purchases/${s.order.purchaseId}/confirm`;
    const send = (signature?: string) => app.inject({ method: 'POST', url: endpoint, headers: { cookie: s.fan.cookie }, payload: { signature } });
    expect((await send('badReceipt')).statusCode).toBe(400);
    expect((await pool.query('SELECT id FROM pulls WHERE user_id=$1', [s.fan.id])).rowCount).toBe(0);
    const legacy = await pool.query("INSERT INTO purchases(user_id,bundle_id,coins,lamports,reference,recipient,tx_signature) VALUES($1,'coins_1000',1000,1,$2,$3,$4) RETURNING id", [s.fan.id, crypto.randomUUID(), treasury, 'used_' + s.order.purchaseId]);
    expect((await send('used_' + s.order.purchaseId)).statusCode).toBe(400);
    await pool.query('UPDATE purchases SET tx_signature=$1 WHERE id=$2', ['reserved_' + s.order.purchaseId, s.order.purchaseId]);
    const count = verifications;
    expect((await send()).statusCode).toBe(200);
    expect(verifications).toBe(count);
    const history = (await app.inject({ url: '/me/pack-purchases', headers: { cookie: s.fan.cookie } })).json().purchases;
    expect(history.find((p: any) => p.purchaseId === s.order.purchaseId).cards).toHaveLength(5);
});
it('RPC verification requires devnet, finalized successful transfer, correct payer, amount, treasury and reference', async () => {
    const reference = encodeKey(Buffer.alloc(32, 9));
    const order = { reference, recipient: treasury, lamports: 5000000, pack_snapshot: { payerWallet: payer } } as PackOrder;
    const base = { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: reference, signer: false }, { pubkey: payer, signer: true }], instructions: [{ programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: payer, destination: treasury, lamports: 5000000 } } }] } } };
    let current: any = base;
    let genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { const body = JSON.parse(init?.body as string); if (body.method === 'getTransaction')
        expect(body.params[1].commitment).toBe('finalized'); return new Response(JSON.stringify({ result: body.method === 'getGenesisHash' ? genesis : current }), { status: 200 }); });
    await expect(livePackChain.verify(order, 'receipt')).resolves.toBeUndefined();
    current = null;
    await expect(livePackChain.verify(order, 'receipt')).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const mutate of [(t: any) => t.meta.err = 'failed', (t: any) => t.transaction.message.accountKeys.shift(), (t: any) => t.transaction.message.accountKeys[1].signer = false, (t: any) => t.transaction.message.instructions[0].parsed.info.lamports = 1, (t: any) => t.transaction.message.instructions[0].parsed.info.destination = payer]) {
        current = structuredClone(base);
        mutate(current);
        await expect(livePackChain.verify(order, 'receipt')).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    current = base;
    genesis = 'mainnet';
    await expect(livePackChain.verify(order, 'receipt')).rejects.toMatchObject({ code: 'VALIDATION' });
    mock.mockRestore();
});
