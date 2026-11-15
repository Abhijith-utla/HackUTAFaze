// BATTLE_RULES v1 — published at GET /battle/rules (like pack odds). Design "Game logic v1" §2d.
// Changing any number that affects resolution must bump `version` (stored on every battle).

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type BattleRole = "founder" | "og" | "creator" | "pro";
export type StatKey = "power" | "clutch" | "style" | "hype";

export const BATTLE_RULES = {
  version: 1,
  swing: 60, // swing roll is 0..swing inclusive
  trickshotBonus: 12,
  trickshotDiv: 400, // trickshot chance = STYLE / trickshotDiv
  clutchBase: 6,
  clutchK: 0.3, // round-3 comeback bonus = clutchBase + floor(HYPE * clutchK)
  roundPoints: [1, 1, 2] as const,
  slots: ["opener", "mid", "closer"] as const,
  statCalls: ["power", "clutch", "style", "hype"] as const, // 3 drawn without replacement per battle
  eraStack: 6,
  eraPair: 3,
  fullSquad: 4,
  squadCap: 9, // ranked only (not in the demo); vault tiers enforce a cap only when the tier sets one
  cost: { common: 1, rare: 2, epic: 3, legendary: 4 } as Record<Rarity, number>,
  serialPerk: { first: 3, low: 1, lowMax: 10 }, // #1 +3, #2..#10 +1 to POWER/CLUTCH/STYLE
  vault: {
    attemptsPerTier: 3,
    tiers: [
      { tier: 1, name: "Rookie", value: 20, xp: 50, costCap: null as number | null },
      { tier: 2, name: "Pro", value: 40, xp: 100, costCap: null as number | null },
      { tier: 3, name: "Elite", value: 60, xp: 200, costCap: null as number | null },
      { tier: 4, name: "Legend", value: 78, xp: 400, costCap: null as number | null },
    ],
  },
  // XP only (never coins, never the ledger). First clear of a tier per UTC day pays the tier XP.
  xp: { vaultRepeatWin: 10, vaultLoss: 5, practiceWin: 10, practiceLoss: 2, practiceRewardedPerDay: 10, perLevel: 200 },
} as const;

/** Each role's modifiers sum to zero: roles change a card's shape, not its total. */
export const ROLE_MODS: Record<BattleRole, { power: number; clutch: number; style: number }> = {
  founder: { power: 6, clutch: 2, style: -8 },
  og: { power: -2, clutch: 8, style: -6 },
  creator: { power: -6, clutch: -4, style: 10 },
  pro: { power: 4, clutch: 8, style: -12 },
};

/** Keyed by set name. Unknown / campaign sets get 0. */
export const ERA_MODS: Record<string, { power: number; clutch: number; style: number; hype: number }> = {
  "OG Era": { power: -2, clutch: -2, style: 4, hype: 0 },
  Creators: { power: 0, clutch: 0, style: 0, hype: 6 },
  "Esports Moments": { power: 0, clutch: 4, style: -4, hype: 0 },
};

/** Fallback when member_roles has no row for a member. */
export const DEFAULT_ROLE: BattleRole = "creator";
export const SEED_ROLES: Record<string, BattleRole> = {
  "FaZe Apex": "founder",
  "FaZe Rain": "og",
  "FaZe Banks": "creator",
  "FaZe Adapt": "creator",
  "FaZe Rug": "creator",
};

export function levelFor(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / BATTLE_RULES.xp.perLevel);
}
