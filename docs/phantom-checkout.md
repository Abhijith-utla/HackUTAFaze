# Phantom checkout — client helper (for Agent C, @Jaideepo7)

Contract: `docs/api.md` → Payments. Devnet only; devnet SOL has no value. Show a "TEST PAYMENT · DEVNET" label next to the buy button.

`npm install @solana/web3.js@1.98.0 -w @faze/client` (pin the exact version).

```ts
// apps/client/lib/phantom.ts
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { CheckoutResponse, ConfirmResponse } from "@faze/shared";

const PAYMENTS = process.env.NEXT_PUBLIC_PAYMENTS_URL ?? "http://localhost:4100";
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

type Phantom = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};

export function getPhantom(): Phantom | undefined {
  const p = (window as unknown as { phantom?: { solana?: Phantom } }).phantom?.solana;
  return p?.isPhantom ? p : undefined; // undefined → show "Install Phantom" link to https://phantom.app
}

/** Full buy flow. Returns the new balance. Coins are credited by the SERVER after it verifies the tx. */
export async function buyCoins(bundleId: string, onStatus?: (s: string) => void): Promise<number> {
  const phantom = getPhantom();
  if (!phantom) throw new Error("Phantom wallet not found");
  const { publicKey: payer } = await phantom.connect();

  onStatus?.("Creating order…");
  const r = await fetch(`${PAYMENTS}/payments/checkout`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bundleId }),
  });
  if (!r.ok) throw new Error((await r.json()).error?.message ?? "checkout failed");
  const order = (await r.json()) as CheckoutResponse;

  const conn = new Connection(RPC, "confirmed");
  const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(order.recipient), lamports: order.lamports });
  // Solana Pay reference: read-only, non-signer key so the server can match this tx to the order.
  ix.keys.push({ pubkey: new PublicKey(order.reference), isSigner: false, isWritable: false });
  const tx = new Transaction().add(ix);
  tx.feePayer = payer;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

  onStatus?.("Approve in Phantom…");
  const { signature } = await phantom.signAndSendTransaction(tx);

  onStatus?.("Confirming on Solana devnet…");
  for (let i = 0; i < 30; i++) {
    const c = await fetch(`${PAYMENTS}/payments/confirm`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purchaseId: order.purchaseId, signature }),
    });
    if (c.ok) return ((await c.json()) as ConfirmResponse).balance;
    if (c.status !== 409) throw new Error((await c.json()).error?.message ?? "payment rejected");
    await new Promise((res) => setTimeout(res, 2000)); // 409 = not confirmed yet
  }
  throw new Error("Still confirming — check Purchases in a minute");
}
```

Phantom must be in **Testnet mode → Solana Devnet** (Settings → Developer settings). Fund with https://faucet.solana.com.

If the user closes the tab mid-payment, calling `POST /payments/confirm {purchaseId}` without a signature makes the server look the payment up by `reference`.
