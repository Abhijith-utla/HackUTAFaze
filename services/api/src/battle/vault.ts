// Vault (daily PvE bosses) + practice ghosts. Opponent building is deterministic from a seed so the
// same day always yields the same bosses, and the same battle seed always yields the same ghost.
import { createHash } from "node:crypto";
import type { Card } from "@faze/shared";
import type { Db } from "../db.js";
import { fail } from "../errors.js";
import { toCard } from "../mappers.js";
import type { Fighter } from "./resolve.js";
import { rngFromSeed, type Rng } from "./rng.js";
import { BATTLE_RULES, type BattleRole, type Rarity } from "./rules.js";
import { battleStats, roleOf, type BattleStats } from "./stats.js";

/** One opponent card as stored (jsonb) and returned (card + stats). setKey/member drive synergies. */
export interface OpponentCard {
  card: Card;
  stats: BattleStats;
  setKey: string;
  member: string;
}

export interface VaultBoss {
  id: string;
  day: string;
  tier: number;
  name: string;
  lineup: OpponentCard[];
  costCap: number | null;
  campaignId: string | null;
}

const RARITY_ORDER: Record<Rarity, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

/** Derives a 32-hex seed from any label (sha256 prefix). */
export const seedFrom = (label: string) => createHash("sha256").update(label).digest("hex").slice(0, 32);

export async function loadRoles(db: Db): Promise<Record<string, BattleRole>> {
  const r = await db.query("SELECT faze_member, role FROM member_roles");
  return Object.fromEntries(r.rows.map((x) => [x.faze_member, x.role as BattleRole]));
}

export const CARD_COLS = "c.*, s.name AS set_name, COALESCE(cs.hype,0)::int AS hype";
const CARD_FROM = "cards c JOIN card_sets s ON s.id = c.set_id LEFT JOIN card_stats cs ON cs.card_id = c.id";

/** Live, non-campaign ("seed") cards in a stable order. */
async function seedPool(db: Db): Promise<any[]> {
  const r = await db.query(
    `SELECT ${CARD_COLS} FROM ${CARD_FROM}
      WHERE s.status = 'live' AND NOT EXISTS (SELECT 1 FROM campaigns cp WHERE cp.set_id = s.id)
      ORDER BY c.id`,
  );
  return r.rows;
}

export function statInput(row: any) {
  return { id: row.id, basePower: row.base_power, rarity: row.rarity as Rarity, fazeMember: row.faze_member, setName: row.set_name };
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Up to 3 rows, preferring distinct members; repeats only if the pool has fewer than 3 cards. */
function pickThree(rows: any[]): any[] {
  const out: any[] = [];
  const members = new Set<string>();
  for (const r of rows) if (out.length < 3 && !members.has(r.faze_member)) (out.push(r), members.add(r.faze_member));
  for (const r of rows) if (out.length < 3 && !out.includes(r)) out.push(r);
  while (out.length && out.length < 3) out.push(out[out.length % rows.length]);
  return out;
}

function bossCard(row: any, v: number, roles: Record<string, BattleRole>): OpponentCard {
  return {
    card: toCard(row),
    // Boss stat line per tier: POWER v / CLUTCH v+4 / STYLE v−4 / HYPE v (design §2b). Fixed, not simulated.
    stats: {
      power: v, clutch: v + 4, style: v - 4, hype: v,
      cost: BATTLE_RULES.cost[row.rarity as Rarity] ?? 1,
      role: roleOf(row.faze_member, roles), era: null, perk: null, hypeSimulated: true,
    },
    setKey: "vault", // all three share the boss "set" → Era Stack, as in the balance sim
    member: row.faze_member,
  };
}

async function buildBoss(db: Db, day: string, tier: number, roles: Record<string, BattleRole>) {
  const def = BATTLE_RULES.vault.tiers[tier - 1];
  if (tier === 4) {
    const camp = await db.query(
      `SELECT id, name, set_id FROM campaigns WHERE status='live' AND set_id IS NOT NULL ORDER BY launched_at DESC NULLS LAST LIMIT 1`,
    );
    if (camp.rowCount) {
      const rows = (await db.query(`SELECT ${CARD_COLS} FROM ${CARD_FROM} WHERE c.set_id = $1`, [camp.rows[0].set_id])).rows;
      rows.sort((a, b) => RARITY_ORDER[a.rarity as Rarity] - RARITY_ORDER[b.rarity as Rarity] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      if (rows.length) {
        return { name: `${camp.rows[0].name} · ${def.name}`, campaignId: camp.rows[0].id as string, lineup: pickThree(rows).map((r) => bossCard(r, def.value, roles)) };
      }
    }
  }
  const pool = await seedPool(db);
  if (!pool.length) fail("CONFLICT", "No cards available to build a Vault boss");
  const rows = pickThree(shuffle(pool, rngFromSeed(seedFrom(`vault:${day}:${tier}`))));
  return { name: `FaZe Vault Keeper · ${def.name}`, campaignId: null, lineup: rows.map((r) => bossCard(r, def.value, roles)) };
}

function toBoss(r: any): VaultBoss {
  return { id: r.id, day: r.day, tier: r.tier, name: r.name, lineup: r.lineup, costCap: r.cost_cap, campaignId: r.campaign_id };
}

/** Today's 4 bosses, built and cached in vault_bosses on first use (race-safe via UNIQUE(day,tier)). */
export async function ensureVaultDay(db: Db, day = todayUtc()): Promise<VaultBoss[]> {
  const sel = () => db.query("SELECT *, day::text AS day FROM vault_bosses WHERE day = $1::date ORDER BY tier", [day]);
  let r = await sel();
  if (r.rowCount! < 4) {
    const have = new Set(r.rows.map((x) => x.tier));
    const roles = await loadRoles(db);
    for (const def of BATTLE_RULES.vault.tiers) {
      if (have.has(def.tier)) continue;
      const b = await buildBoss(db, day, def.tier, roles);
      await db.query(
        `INSERT INTO vault_bosses (day, tier, name, lineup, cost_cap, campaign_id, rules_version)
         VALUES ($1::date,$2,$3,$4,$5,$6,$7) ON CONFLICT (day, tier) DO NOTHING`,
        [day, def.tier, b.name, JSON.stringify(b.lineup), def.costCap, b.campaignId, BATTLE_RULES.version],
      );
    }
    r = await sel();
  }
  return r.rows.map(toBoss);
}

/**
 * Practice ghost: 3 distinct seed cards whose total cost is as close as possible to targetCost,
 * chosen by an RNG derived from the battle seed (so it is reproducible).
 */
export async function buildGhost(db: Db, battleSeed: string, targetCost: number, roles: Record<string, BattleRole>): Promise<OpponentCard[]> {
  const pool = await seedPool(db);
  if (pool.length < 3) fail("CONFLICT", "Not enough cards to build a practice opponent");
  const rng = rngFromSeed(seedFrom(`ghost:${battleSeed}`));
  const cost = (r: any) => BATTLE_RULES.cost[r.rarity as Rarity] ?? 1;
  let best: any[] = [];
  let bestDiff = Infinity;
  for (let t = 0; t < 400 && bestDiff > 0; t++) {
    const i = rng.int(0, pool.length - 1);
    let j = rng.int(0, pool.length - 2);
    if (j >= i) j++;
    let k = rng.int(0, pool.length - 3);
    for (const x of [i, j].sort((a, b) => a - b)) if (k >= x) k++;
    const trio = [pool[i], pool[j], pool[k]];
    const diff = Math.abs(trio.reduce((s, r) => s + cost(r), 0) - targetCost);
    if (diff < bestDiff) (best = trio), (bestDiff = diff);
  }
  return best.map((row) => ({
    card: toCard(row),
    stats: battleStats(statInput(row), null, row.hype, roles),
    setKey: row.set_id,
    member: row.faze_member,
  }));
}

export const toFighters = (xs: { stats: BattleStats; setKey: string; member: string }[]): Fighter[] =>
  xs.map((x) => ({ setKey: x.setKey, member: x.member, stats: x.stats }));
