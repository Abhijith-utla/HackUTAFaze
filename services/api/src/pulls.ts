import { randomInt } from "node:crypto";
import type { Rarity } from "@faze/shared";

export const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];

/** Roll one rarity from published odds ({rarity: percent}, sums to 100) with a CSPRNG. */
export function rollRarity(odds: Partial<Record<Rarity, number>>, rand: (max: number) => number = randomInt): Rarity {
  const SCALE = 10_000; // supports odds with 2 decimals
  const r = rand(SCALE);
  let acc = 0;
  for (const rar of RARITY_ORDER) {
    acc += Math.round((odds[rar] ?? 0) * (SCALE / 100));
    if (r < acc) return rar;
  }
  // Rounding leftovers fall to the most common rarity that has odds.
  return RARITY_ORDER.find((x) => (odds[x] ?? 0) > 0) ?? "common";
}

export type CardSlot = { id: string; rarity: Rarity; maxSupply: number | null; minted: number };

/**
 * Pick an available card: same rarity first, then each lower rarity. Mutates `minted` for the pick.
 * Returns null when everything at or below the rolled rarity is sold out.
 */
export function pickCard(cards: CardSlot[], rolled: Rarity, rand: (max: number) => number = randomInt): CardSlot | null {
  for (let i = RARITY_ORDER.indexOf(rolled); i >= 0; i--) {
    const pool = cards.filter((c) => c.rarity === RARITY_ORDER[i] && (c.maxSupply === null || c.minted < c.maxSupply));
    if (pool.length) {
      const pick = pool[rand(pool.length)];
      pick.minted++;
      return pick;
    }
  }
  return null;
}
