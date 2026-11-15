import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { CheckoutResponse, ConfirmResponse } from '@faze/shared';
import { request, ApiError } from './api';
import { WalletError, connectPhantom, requirePhantom, signAndSendDevnet } from './wallet';
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
    const phantom = requirePhantom();
    onStatus('Connecting to Phantom…');
    const publicKey: PublicKey = await connectPhantom();
    const storageKey = `faze.pack.${userId}.${packId}`;
    let saved: SavedPackCheckout | null = null;
    try {
        saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    }
    catch { }
    if (!saved?.key || saved.wallet !== publicKey.toBase58()) {
        if (saved?.order)
            throw Error('A purchase is pending with a different wallet. Switch Phantom back to the wallet you used before and press Buy again.');
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
            saved.signature = await signAndSendDevnet(phantom, connection, tx);
            save();
        }
        catch (e) {
            // Only allow a fresh send when we are sure nothing was broadcast; an uncertain failure keeps `attempted` so the next
            // Buy checks the chain first (see the attempted && !signature branch above).
            if (!(e as WalletError).uncertain) { saved.attempted = false; save(); }
            if ((e as WalletError).code === 4001) throw Error('Payment cancelled in Phantom. No pack was opened.');
            throw Error((e as Error).message);
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
    throw Error('Still confirming. Press Buy again to resume; you will not be charged twice.');
}
