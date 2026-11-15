// Buy coins with devnet SOL via Phantom. Server is authoritative: coins are only credited
// after /payments/confirm verifies the tx on-chain. Never credit client-side.
import { Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } from "@solana/web3.js";
import { api, ApiFailure } from "./api";

type Phantom = {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};
declare global { interface Window { phantom?: { solana?: Phantom } } }

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function buyCoins(bundleId: string, onStatus: (s: string) => void): Promise<number> {
  const checkout = await api.checkout(bundleId);
  if (USE_MOCK) { onStatus("Mock payment…"); return (await api.confirm(checkout.purchaseId, "mock")).balance; }

  const phantom = window.phantom?.solana;
  if (!phantom?.isPhantom) throw new Error("Phantom wallet not found. Install it and switch to Devnet.");
  onStatus("Connecting Phantom…");
  const { publicKey } = await phantom.connect();

  onStatus("Approve the devnet transaction in Phantom…");
  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");
  const ix = SystemProgram.transfer({
    fromPubkey: publicKey, toPubkey: new PublicKey(checkout.recipient), lamports: checkout.lamports,
  });
  // Solana Pay reference: read-only, non-signer key lets the server find this tx.
  ix.keys.push({ pubkey: new PublicKey(checkout.reference), isSigner: false, isWritable: false });
  const tx = new Transaction().add(ix);
  tx.feePayer = publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const { signature } = await phantom.signAndSendTransaction(tx);

  onStatus("Waiting for on-chain confirmation…");
  for (let i = 0; i < 30; i++) {
    try { return (await api.confirm(checkout.purchaseId, signature)).balance; }
    catch (e) { if (!(e instanceof ApiFailure && e.status === 409)) throw e; await sleep(2000); }
  }
  throw new Error("Payment not confirmed yet. Check My purchases shortly.");
}
