import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { CheckoutResponse, ConfirmResponse } from '@faze/shared';
import { request, ApiError } from './api';
type Phantom = {
    isPhantom?: boolean;
    connect(): Promise<{
        publicKey: PublicKey;
    }>;
    signAndSendTransaction(tx: Transaction): Promise<{
        signature: string;
    }>;
};
export type PackPurchase = {
    purchaseId: string;
    packId: string;
    packName: string;
    status: string;
    lamports: number;
    pullId?: string;
    cards?: import('@faze/shared').CardInstance[];
};
type PackCheckout = {
    purchaseId: string;
    packId: string;
    recipient: string;
    reference: string;
    lamports: number;
    cluster: string;
    simulated: boolean;
    status: string;
};
type SavedPackCheckout = {
    key: string;
    wallet: string;
    order?: PackCheckout;
    signature?: string;
    attempted?: boolean;
};
export async function confirmPackPurchase(purchaseId: string, signature?: string) { return request<PackPurchase>(`/pack-purchases/${purchaseId}/confirm`, { signature }); }
export function clearPackCheckout(userId: string, packId: string, purchaseId: string) { const key = `faze.pack.${userId}.${packId}`; try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.order?.purchaseId === purchaseId)
        localStorage.removeItem(key);
}
catch { /* A damaged local hint cannot affect server fulfillment. */ } }
export async function buyPack(packId: string, userId: string, onStatus: (status: string) => void) {
    const w = window as unknown as {
        phantom?: {
            solana?: Phantom;
        };
        solana?: Phantom;
    };
    const phantom = w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana?.isPhantom ? w.solana : undefined;
    if (!phantom)
        throw Error('Phantom not found. Install the Phantom extension, unlock it, switch it to Solana Devnet (Settings > Developer Settings > Testnet Mode), then reload.');
    onStatus('Connecting to Phantom…');
    let publicKey: PublicKey;
    try {
        ({ publicKey } = await phantom.connect());
    }
    catch (e) {
        throw Error((e as { code?: number }).code === 4001 ? 'Wallet connection was declined in Phantom. Approve the connect prompt to buy a pack.' : 'Could not connect to Phantom. Unlock it and try again.');
    }
    const storageKey = `faze.pack.${userId}.${packId}`;
    let saved: SavedPackCheckout | null = null;
    try {
        saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    }
    catch { }
    if (!saved?.key || saved.wallet !== publicKey.toBase58()) {
        if (saved?.order)
            throw Error('A purchase is pending with another wallet. Check it below before buying again.');
        saved = { key: crypto.randomUUID(), wallet: publicKey.toBase58() };
    }
    const save = () => localStorage.setItem(storageKey, JSON.stringify(saved));
    save();
    saved.order = await request<PackCheckout>(`/packs/${packId}/checkout`, { payerWallet: saved.wallet, idempotencyKey: saved.key });
    save();
    const order = saved.order;
    if (order.status === 'paid') {
        const result = await confirmPackPurchase(order.purchaseId);
        clearPackCheckout(userId, packId, order.purchaseId);
        return result;
    }
    if (order.cluster !== 'devnet')
        throw Error('Only Solana devnet pack payments are supported.');
    if (order.simulated)
        throw Error('Wallet payments are disabled while PAYMENTS_SIMULATE=1. Set it to 0 on the server for Phantom devnet payments.');
    if (saved.attempted && !saved.signature) {
        // A previous attempt never produced a signature. If the chain has nothing for this order's reference, it is safe to send again.
        try {
            const result = await confirmPackPurchase(order.purchaseId);
            clearPackCheckout(userId, packId, order.purchaseId);
            return result;
        }
        catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409)
                throw e;
            saved.attempted = false;
            save();
        }
    }
    if (!saved.attempted) {
        const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
        const transfer = SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(order.recipient), lamports: order.lamports });
        transfer.keys.push({ pubkey: new PublicKey(order.reference), isSigner: false, isWritable: false });
        const tx = new Transaction().add(transfer);
        tx.feePayer = publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const fee = (await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')).value;
        if (fee === null) throw Error('Could not estimate the network fee. Try again before sending payment.');
        if (await connection.getBalance(publicKey, 'confirmed') < order.lamports + fee) throw Error('Not enough devnet SOL for this pack and its network fee. Fund your devnet wallet and try again.');
        onStatus('Approve the pack payment in Phantom (devnet SOL).');
        saved.attempted = true;
        save();
        try {
            saved.signature = (await phantom.signAndSendTransaction(tx)).signature;
            save();
        }
        catch (e) {
            if ((e as {
                code?: number;
            }).code === 4001) {
                saved.attempted = false;
                save();
                throw Error('Payment cancelled in Phantom. No pack was opened.');
            }
            saved.attempted = false;
            save();
            throw Error(`Phantom could not send the payment: ${(e as { message?: string }).message || 'unknown error'}. Make sure Phantom is on Solana Devnet and try again; nothing was sent.`);
        }
    }
    onStatus('Waiting for finalized payment. Your pack will open after server verification.');
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const result = await confirmPackPurchase(order.purchaseId, saved.signature);
            clearPackCheckout(userId, packId, order.purchaseId);
            return result;
        }
        catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409)
                throw e;
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw Error('Still confirming. Use Check payment in Store purchases; do not pay again.');
}
