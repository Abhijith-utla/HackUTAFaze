import type { Bundle } from "@faze/shared";

// Coin bundles priced in DEVNET SOL (no real value — test payments). Coins are not cashable (master.md §3).
export const BUNDLES: readonly Bundle[] = [
  { id: "coins_1000", coins: 1000, lamports: 50_000_000 }, // 0.05 devnet SOL
  { id: "coins_2500", coins: 2500, lamports: 100_000_000 }, // 0.1
  { id: "coins_6000", coins: 6000, lamports: 200_000_000 }, // 0.2
];

export function findBundle(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}
