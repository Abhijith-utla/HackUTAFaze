// Single seam for "buy coins". Provider = Solana (devnet), per Jaideep's direction.
// Contract for this is NOT frozen yet: waiting on the lead (@Abhijith-utla) to define
// /payments/checkout for Solana. Swap only this file when it lands.
export type SolanaCheckout = { reference: string; recipient: string; lamports: number; cluster: "devnet" };

export async function startCoinPurchase(_bundleId: string): Promise<SolanaCheckout> {
  throw new Error("Solana checkout contract pending from lead; see the board.");
}
