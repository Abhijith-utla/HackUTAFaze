import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { CheckoutResponse, ConfirmResponse } from '@faze/shared';
import { request, PAYMENTS, ApiError } from './api';
type Phantom = {
    isPhantom?: boolean;
    connect(): Promise<{
        publicKey: PublicKey;
    }>;
    signAndSendTransaction(tx: Transaction): Promise<{
        signature: string;
    }>;
};
export async function confirmPayment(purchaseId: string, signature?: string) { return request<ConfirmResponse>('/payments/confirm', { purchaseId, signature }, PAYMENTS); }
export async function buyCoins(bundleId: string, onStatus: (s: string) => void) {
    const phantom = (window as unknown as {
        phantom?: {
            solana?: Phantom;
        };
    }).phantom?.solana;
    if (!phantom?.isPhantom)
        throw Error('Install Phantom at phantom.app, then enable Solana Devnet in its developer settings.');
    const { publicKey } = await phantom.connect();
    const order = await request<CheckoutResponse>('/payments/checkout', { bundleId }, PAYMENTS);
    if (order.cluster !== 'devnet')
        throw Error('Only Solana devnet demo payments are supported.');
    const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const ix = SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(order.recipient), lamports: order.lamports });
    ix.keys.push({ pubkey: new PublicKey(order.reference), isSigner: false, isWritable: false });
    const tx = new Transaction().add(ix);
    tx.feePayer = publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    onStatus('Approve the devnet payment in Phantom.');
    const { signature } = await phantom.signAndSendTransaction(tx);
    onStatus('Payment sent. Waiting for server confirmation.');
    for (let i = 0; i < 30; i++) {
        try {
            return await confirmPayment(order.purchaseId, signature);
        }
        catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409)
                throw e;
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw Error('Still confirming. Open Purchases and choose Check payment; do not pay again.');
}
