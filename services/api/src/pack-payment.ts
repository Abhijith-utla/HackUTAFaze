import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { requireUser } from './auth.js';
import { fail } from './errors.js';
import { lockUser } from './ledger.js';
import { mintPack, loadInstances } from './pack-mint.js';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encodeKey(bytes: Buffer) { let n = BigInt('0x' + bytes.toString('hex')), out = ''; while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
} for (const b of bytes) {
    if (b !== 0)
        break;
    out = '1' + out;
} return out; }
function isKey(key: string) { if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key))
    return false; let n = 0n; for (const c of key)
    n = n * 58n + BigInt(alphabet.indexOf(c)); const size = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2); return size + (key.match(/^1*/)?.[0].length ?? 0) === 32; }
export function packPriceLamports(coins: number) { const rate = Number(process.env.PACK_LAMPORTS_PER_COIN ?? 50000), price = coins * rate; if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(price) || price <= 0)
    throw Error('Invalid pack SOL pricing configuration'); return price; }
export type PackOrder = {
    id: string;
    user_id: string;
    reference: string;
    recipient: string;
    lamports: string | number;
    pack_snapshot: any;
    tx_signature: string | null;
    pack_pull_id: string | null;
    status: string;
    payer_wallet?: string;
};
export interface PackChain {
    verify(order: PackOrder, signature: string): Promise<void>;
    find(reference: string): Promise<string | undefined>;
}
function settings() { const recipient = process.env.SOLANA_TREASURY_PUBKEY ?? ''; const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'; const simulated = process.env.PAYMENTS_SIMULATE === '1'; if ((process.env.SOLANA_CLUSTER ?? 'devnet') !== 'devnet' || /mainnet/i.test(rpc))
    fail('VALIDATION', 'Pack payments require Solana devnet'); if (simulated && process.env.NODE_ENV === 'production')
    fail('VALIDATION', 'Simulated payments are disabled in production'); if (!isKey(recipient))
    fail('CONFLICT', 'Configure a valid devnet treasury wallet before buying packs'); return { recipient, rpc, simulated }; }
async function rpc(method: string, params: unknown[]) { const { rpc: url } = settings(); try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
    if (!res.ok)
        throw Error('RPC failed');
    const data = await res.json() as any;
    if (data.error)
        throw Error('RPC error');
    return data.result;
}
catch {
    fail('CONFLICT', 'Solana RPC unavailable. Check this purchase again; do not pay twice.');
} }
export const livePackChain: PackChain = {
    async find(reference) { const rows = await rpc('getSignaturesForAddress', [reference, { limit: 20 }, 'finalized']); return rows?.find((r: any) => !r.err)?.signature; },
    async verify(order, signature) {
        const cfg = settings();
        if (cfg.simulated) {
            if (signature !== `sim_${order.reference}_${order.lamports}`)
                fail('VALIDATION', 'Invalid simulated pack payment');
            return;
        }
        if (await rpc('getGenesisHash', []) !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
            fail('VALIDATION', 'Configured RPC is not Solana devnet');
        const t = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
        if (!t)
            fail('CONFLICT', 'Awaiting finalized payment. Check again shortly.');
        if (!t.meta || t.meta.err)
            fail('VALIDATION', 'Transaction failed on-chain');
        const msg = t.transaction?.message, keys = msg?.accountKeys ?? [];
        if (!keys.some((k: any) => k.pubkey === order.reference))
            fail('VALIDATION', 'Payment reference does not match this pack');
        const payer = order.pack_snapshot.payerWallet;
        if (!keys.some((k: any) => k.pubkey === payer && k.signer))
            fail('VALIDATION', 'Payer wallet did not sign this transaction');
        const matches = (msg.instructions ?? []).some((i: any) => i.programId === '11111111111111111111111111111111' && i.parsed?.type === 'transfer' && i.parsed.info.source === payer && i.parsed.info.destination === order.recipient && BigInt(i.parsed.info.lamports) === BigInt(order.lamports));
        if (!matches)
            fail('VALIDATION', 'Transaction does not contain the required SOL transfer');
    }
};
const params = z.object({ id: z.string().uuid() });
async function result(order: PackOrder) { const pull = order.pack_pull_id ? (await pool.query('SELECT * FROM pulls WHERE id=$1', [order.pack_pull_id])).rows[0] : null; return { purchaseId: order.id, packId: order.pack_snapshot.pack.id, packName: order.pack_snapshot.pack.name, status: order.status, lamports: Number(order.lamports), ...(pull ? { pullId: pull.id, cards: await loadInstances(pool, pull.card_instance_ids) } : {}) }; }
export async function paidPackRoutes(app: FastifyInstance, chain: PackChain = livePackChain) {
    app.post('/packs/:id/checkout', async (req, reply) => {
        const user = requireUser(req), { id } = params.parse(req.params), b = z.object({ payerWallet: z.string(), idempotencyKey: z.string().uuid() }).parse(req.body);
        if (!isKey(b.payerWallet))
            fail('VALIDATION', 'Invalid payer wallet');
        const cfg = settings();
        const order = await tx(async (c) => {
            await lockUser(c, user.sub);
            const existing = await c.query("SELECT * FROM purchases WHERE user_id=$1 AND pack_snapshot->>'checkoutKey'=$2", [user.sub, b.idempotencyKey]);
            if (existing.rowCount) {
                const o = existing.rows[0];
                if (o.pack_snapshot.pack.id !== id || o.pack_snapshot.payerWallet !== b.payerWallet)
                    fail('CONFLICT', 'Checkout key already used for another request');
                return o;
            }
            const pack = (await c.query("SELECT p.* FROM packs p JOIN card_sets s ON s.id=p.set_id WHERE p.id=$1 AND p.active AND s.status='live'", [id])).rows[0];
            if (!pack)
                fail('NOT_FOUND', 'Pack not available');
            // A permanent common fallback prevents exhausted limited cards from losing a paid pull.
            if (!(await c.query("SELECT 1 FROM cards WHERE set_id=$1 AND rarity='common' AND max_supply IS NULL LIMIT 1", [pack.set_id])).rowCount)
                fail('CONFLICT', 'This pack is not currently available for SOL checkout');
            const snapshot = { pack, payerWallet: b.payerWallet, checkoutKey: b.idempotencyKey };
            return (await c.query("INSERT INTO purchases(user_id,bundle_id,coins,lamports,reference,recipient,cluster,test_mode,pack_snapshot) VALUES($1,$2,0,$3,$4,$5,'devnet',true,$6) RETURNING *", [user.sub, 'pack:' + id, packPriceLamports(pack.price_coins), encodeKey(randomBytes(32)), cfg.recipient, snapshot])).rows[0];
        });
        return reply.code(201).send({ purchaseId: order.id, packId: id, recipient: order.recipient, reference: order.reference, lamports: Number(order.lamports), cluster: 'devnet', simulated: cfg.simulated, status: order.status });
    });
    app.get('/me/pack-purchases', async (req) => { const user = requireUser(req); return { purchases: await Promise.all((await pool.query('SELECT * FROM purchases WHERE user_id=$1 AND pack_snapshot IS NOT NULL ORDER BY created_at DESC LIMIT 50', [user.sub])).rows.map(result)) }; });
    app.post('/pack-purchases/:id/confirm', async (req) => {
        const user = requireUser(req), { id } = params.parse(req.params), b = z.object({ signature: z.string().max(128).optional() }).parse(req.body ?? {});
        let order = (await pool.query('SELECT * FROM purchases WHERE id=$1 AND user_id=$2 AND pack_snapshot IS NOT NULL', [id, user.sub])).rows[0] as PackOrder | undefined;
        if (!order)
            fail('NOT_FOUND', 'Pack purchase not found');
        if (order.pack_pull_id)
            return result(order);
        if (!order.tx_signature) {
            const signature = b.signature ?? await chain.find(order.reference);
            if (!signature)
                fail('CONFLICT', 'Payment not found yet. Retry confirmation without paying again.');
            await chain.verify(order, signature);
            try {
                await tx(async (c) => { const locked = (await c.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (locked.tx_signature && locked.tx_signature !== signature)
                    fail('CONFLICT', 'Another transaction is already reserved'); await c.query('UPDATE purchases SET tx_signature=$1 WHERE id=$2', [signature, id]); });
            }
            catch (e) {
                if ((e as {
                    code?: string;
                }).code === '23505')
                    fail('VALIDATION', 'Transaction already used for a purchase');
                throw e;
            }
        }
        await tx(async (c) => { await lockUser(c, user.sub); const o = (await c.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (o.pack_pull_id)
            return; if (!o.tx_signature)
            fail('CONFLICT', 'Payment is not verified'); const minted = await mintPack(c, user.sub, o.pack_snapshot.pack); await c.query("UPDATE purchases SET status='paid',paid_at=now(),pack_pull_id=$1 WHERE id=$2", [minted.pullId, id]); });
        order = (await pool.query('SELECT * FROM purchases WHERE id=$1', [id])).rows[0];
        return result(order!);
    });
}
