import type { Bundle } from "@faze/shared";

// Coin bundles. Test mode only — coins are not cashable (master.md §3).
export const BUNDLES: readonly Bundle[] = [
  { id: "coins_1000", coins: 1000, priceCents: 499 },
  { id: "coins_2500", coins: 2500, priceCents: 999 },
  { id: "coins_6000", coins: 6000, priceCents: 1999 },
];

export function findBundle(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}
