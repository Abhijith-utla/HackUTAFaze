// Battle stat model (design §1), ported from scratchpad sim.py. Pure: no DB access.
import { createHash } from "node:crypto";
import { BATTLE_RULES, DEFAULT_ROLE, ERA_MODS, ROLE_MODS, SEED_ROLES, type BattleRole, type Rarity } from "./rules.js";

export interface StatCardInput {
  id: string;
  basePower: number;
  rarity: Rarity;
  fazeMember: string;
  /** Set name (era). Unknown names get no era modifier. */
  setName?: string | null;
}

export type SerialPerk = "first_edition" | "low_serial" | null;

export interface BattleStats {
  power: number;
  clutch: number;
  style: number;
  /** Live fan heat — SIMULATED engagement, label it in the UI. */
  hype: number;
  cost: number;
  role: BattleRole;
  era: string | null;
  perk: SerialPerk;
  hypeSimulated: true;
}

const clamp = (x: number) => Math.max(1, Math.min(99, x));

/** Stable per-card spread −3..+3: sha256(cardId + ':' + X) mod 7 − 3 (X = P | C | S), as in sim.py. */
export function jitter(cardId: string, stat: "P" | "C" | "S"): number {
  const hex = createHash("sha256").update(`${cardId}:${stat}`).digest("hex");
  return Number(BigInt("0x" + hex) % 7n) - 3;
}

export function serialPerk(serial: number | null | undefined): SerialPerk {
  if (serial == null) return null;
  if (serial === 1) return "first_edition";
  if (serial >= 2 && serial <= BATTLE_RULES.serialPerk.lowMax) return "low_serial";
  return null;
}

export function roleOf(member: string, roles?: Record<string, BattleRole>): BattleRole {
  return roles?.[member] ?? SEED_ROLES[member] ?? DEFAULT_ROLE;
}

/**
 * POWER/CLUTCH/STYLE = B + role + era + jitter + serialPerk (clamped 1..99);
 * HYPE = floor((B + liveHype) / 2) + era.hype (clamped). Cost by rarity.
 * `roles` is the member_roles table (falls back to the seed roles, then 'creator').
 */
export function battleStats(
  card: StatCardInput,
  instance: { serial: number } | null | undefined,
  hype: number,
  roles?: Record<string, BattleRole>,
): BattleStats {
  const B = card.basePower;
  const role = roleOf(card.fazeMember, roles);
  const r = ROLE_MODS[role];
  const eraName = card.setName && ERA_MODS[card.setName] ? card.setName : null;
  const e = eraName ? ERA_MODS[eraName] : { power: 0, clutch: 0, style: 0, hype: 0 };
  const perk = serialPerk(instance?.serial);
  const sb = perk === "first_edition" ? BATTLE_RULES.serialPerk.first : perk === "low_serial" ? BATTLE_RULES.serialPerk.low : 0;
  const h = Math.max(0, Math.min(100, Math.trunc(hype || 0)));
  return {
    power: clamp(B + r.power + e.power + jitter(card.id, "P") + sb),
    clutch: clamp(B + r.clutch + e.clutch + jitter(card.id, "C") + sb),
    style: clamp(B + r.style + e.style + jitter(card.id, "S") + sb),
    hype: clamp(Math.floor((B + h) / 2) + e.hype),
    cost: BATTLE_RULES.cost[card.rarity] ?? 1,
    role,
    era: eraName,
    perk,
    hypeSimulated: true,
  };
}
