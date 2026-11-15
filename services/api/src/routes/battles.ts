// Battles demo slice (contract v1.9 draft, design "Game logic v1"). Server-authoritative: the result is
// resolved and committed in the same request that creates the battle; the client only animates it.
// No stakes: cards are never locked or consumed, nothing touches the ledger, rewards are XP + badges.
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { pool, tx, type Db } from "../db.js";
import { fail } from "../errors.js";
import { lockUser } from "../ledger.js";
import { toCard } from "../mappers.js";
import { resolve, type Bonus, type Round } from "../battle/resolve.js";
import { BATTLE_RULES, ERA_MODS, levelFor, ROLE_MODS } from "../battle/rules.js";
import { battleStats } from "../battle/stats.js";
import { buildGhost, CARD_COLS, ensureVaultDay, loadRoles, statInput, toFighters, todayUtc, type OpponentCard } from "../battle/vault.js";

const CreateBattleBody = z
  .object({
    mode: z.enum(["vault", "practice"]),
    tier: z.number().int().min(1).max(4).optional(),
    lineup: z.array(z.string().uuid()).length(3),
    idempotencyKey: z.string().min(8).max(128),
  })
  .refine((b) => new Set(b.lineup).size === 3, { message: "Lineup cards must be 3 different cards", path: ["lineup"] })
  .refine((b) => b.mode !== "vault" || b.tier !== undefined, { message: "tier is required for vault battles", path: ["tier"] });
const Id = z.object({ id: z.string().uuid() });

const RARITY_RANK = "CASE c.rarity WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1 WHEN 'rare' THEN 2 ELSE 3 END";

interface PlayerCard extends OpponentCard {
  instanceId: string;
  serial: number;
}

const sumTotals = (rounds: Round[], side: "player" | "opponent") => rounds.reduce((s, r) => s + r[side].total, 0);

function toBattle(r: any, playerName: string) {
  const rounds: Round[] = r.rounds;
  const synergyOf = (side: "player" | "opponent"): Bonus[] => rounds[0]?.[side].bonuses ?? [];
  return {
    id: r.id,
    mode: r.mode,
    tier: r.tier,
    seed: r.seed,
    rulesVersion: r.rules_version,
    createdAt: new Date(r.created_at).toISOString(),
    result: r.result,
    playerPoints: r.player_points,
    opponentPoints: r.opponent_points,
    playerTotal: sumTotals(rounds, "player"),
    opponentTotal: sumTotals(rounds, "opponent"),
    decidedByTotal: r.player_points === r.opponent_points,
    player: {
      name: playerName,
      synergy: synergyOf("player"),
      lineup: (r.player_lineup as PlayerCard[]).map((x) => ({ instanceId: x.instanceId, serial: x.serial, card: x.card, stats: x.stats })),
    },
    opponent: {
      name: r.opponent.name,
      synergy: synergyOf("opponent"),
      lineup: (r.opponent.lineup as OpponentCard[]).map((x) => ({ card: x.card, stats: x.stats })),
    },
    rounds,
    rewards: r.rewards,
    demo: r.demo,
  };
}

async function playerName(db: Db, userId: string) {
  const u = (await db.query("SELECT display_name, display_name_status FROM users WHERE id=$1", [userId])).rows[0];
  return u?.display_name_status === "approved" ? u.display_name : "You";
}

async function vaultStatus(db: Db, userId: string, bossIds: string[]) {
  const r = await db.query(
    `SELECT boss_id, count(*)::int AS attempts, bool_or(result='win') AS cleared
       FROM battles WHERE user_id=$1 AND boss_id = ANY($2::uuid[]) GROUP BY boss_id`,
    [userId, bossIds],
  );
  return new Map<string, { attempts: number; cleared: boolean }>(r.rows.map((x) => [x.boss_id, { attempts: x.attempts, cleared: !!x.cleared }]));
}

export async function battlesRoutes(app: FastifyInstance) {
  app.get("/battle/rules", async (req) => {
    requireUser(req);
    const roles = await loadRoles(pool);
    return {
      rulesVersion: BATTLE_RULES.version,
      constants: BATTLE_RULES,
      roles,
      defaultRole: "creator",
      roleMods: ROLE_MODS,
      eraMods: ERA_MODS,
      costs: BATTLE_RULES.cost,
      notes: [
        "HYPE is driven by simulated engagement (demo).",
        "Battles never lock, consume or risk cards and never move coins. Rewards are XP and badges only.",
      ],
    };
  });

  app.get("/me/battle-cards", async (req) => {
    const s = requireUser(req);
    const roles = await loadRoles(pool);
    const r = await pool.query(
      `SELECT ${CARD_COLS}, ci.id AS ci_id, ci.serial, ci.locked_by_trade_id, ci.market_listing_id, ci.market_offer_id
         FROM card_instances ci JOIN cards c ON c.id = ci.card_id JOIN card_sets s ON s.id = c.set_id
         LEFT JOIN card_stats cs ON cs.card_id = c.id
        WHERE ci.owner_id = $1 ORDER BY ${RARITY_RANK}, c.name, ci.serial`,
      [s.sub],
    );
    return {
      cards: r.rows.map((row) => ({
        instanceId: row.ci_id,
        serial: row.serial,
        // Informational only: reserved cards can still battle (battles never move ownership).
        locked: row.locked_by_trade_id !== null || row.market_listing_id !== null || row.market_offer_id !== null,
        card: toCard(row),
        stats: battleStats(statInput(row), { serial: row.serial }, row.hype, roles),
      })),
    };
  });

  app.get("/battle/vault", async (req) => {
    const s = requireUser(req);
    const day = todayUtc();
    const bosses = await ensureVaultDay(pool, day);
    const st = await vaultStatus(pool, s.sub, bosses.map((b) => b.id));
    return {
      day,
      attemptsPerTier: BATTLE_RULES.vault.attemptsPerTier,
      bosses: bosses.map((b) => {
        const def = BATTLE_RULES.vault.tiers[b.tier - 1];
        const x = st.get(b.id) ?? { attempts: 0, cleared: false };
        return {
          id: b.id,
          tier: b.tier,
          tierName: def.name,
          name: b.name,
          campaignId: b.campaignId,
          lineup: b.lineup.map((c) => ({ card: c.card, stats: c.stats })),
          attemptsLeft: Math.max(0, BATTLE_RULES.vault.attemptsPerTier - x.attempts),
          cleared: x.cleared,
          costCap: b.costCap,
          rewards: { firstClearXp: def.xp, badge: b.tier === 4 },
          demo: true,
        };
      }),
    };
  });

  app.post("/battles", async (req, reply) => {
    const s = requireUser(req);
    const body = CreateBattleBody.parse(req.body);

    const out = await tx(async (c: pg.PoolClient) => {
      await lockUser(c, s.sub); // serializes this user's battles: attempts + idempotency

      const prior = await c.query("SELECT * FROM battles WHERE user_id=$1 AND idempotency_key=$2", [s.sub, body.idempotencyKey]);
      if (prior.rowCount) return { status: 200, row: prior.rows[0] };

      // FOR SHARE: a concurrent trade swap of these cards waits for us (or we see the new owner).
      const inst = await c.query(
        `SELECT ${CARD_COLS}, ci.id AS ci_id, ci.serial, ci.owner_id
           FROM card_instances ci JOIN cards c ON c.id = ci.card_id JOIN card_sets s ON s.id = c.set_id
           LEFT JOIN card_stats cs ON cs.card_id = c.id
          WHERE ci.id = ANY($1::uuid[]) ORDER BY ci.id FOR SHARE OF ci`,
        [body.lineup],
      );
      const byId = new Map(inst.rows.map((r) => [r.ci_id, r]));
      const roles = await loadRoles(c);
      const player: PlayerCard[] = body.lineup.map((id) => {
        const row = byId.get(id);
        if (!row || row.owner_id !== s.sub) fail("NOT_FOUND", `You don't own card ${id}`);
        return {
          instanceId: id,
          serial: row.serial,
          card: toCard(row),
          stats: battleStats(statInput(row), { serial: row.serial }, row.hype, roles),
          setKey: row.set_id,
          member: row.faze_member,
        };
      });
      const cost = player.reduce((n, p) => n + p.stats.cost, 0);

      const seed = randomBytes(16).toString("hex");
      let opponent: { name: string; lineup: OpponentCard[] };
      let bossId: string | null = null;
      let tier: number | null = null;
      let firstClear = false;
      let day = todayUtc();
      let practiceToday = 0;

      if (body.mode === "vault") {
        const bosses = await ensureVaultDay(c, day);
        const boss = bosses.find((b) => b.tier === body.tier) ?? fail("NOT_FOUND", "No Vault boss for that tier today");
        day = boss.day;
        if (boss.costCap !== null && cost > boss.costCap) fail("VALIDATION", `Squad cost ${cost} is over this tier's cap of ${boss.costCap}`);
        const x = (await vaultStatus(c, s.sub, [boss.id])).get(boss.id) ?? { attempts: 0, cleared: false };
        if (x.attempts >= BATTLE_RULES.vault.attemptsPerTier) fail("CONFLICT", "No attempts left for this Vault tier today");
        firstClear = !x.cleared;
        bossId = boss.id;
        tier = boss.tier;
        opponent = { name: boss.name, lineup: boss.lineup };
      } else {
        opponent = { name: "Practice Ghost", lineup: await buildGhost(c, seed, cost, roles) };
        practiceToday = (
          await c.query(
            "SELECT count(*)::int AS n FROM battles WHERE user_id=$1 AND mode='practice' AND (created_at AT TIME ZONE 'UTC')::date = $2::date",
            [s.sub, day],
          )
        ).rows[0].n;
      }

      const res = resolve(seed, toFighters(player), toFighters(opponent.lineup));
      const won = res.result === "win";
      const X = BATTLE_RULES.xp;
      let xp: number;
      let badge: { id: string; label: string } | undefined;
      if (body.mode === "vault") {
        const def = BATTLE_RULES.vault.tiers[tier! - 1];
        xp = won ? (firstClear ? def.xp : X.vaultRepeatWin) : X.vaultLoss;
        if (won && firstClear && tier === 4) badge = { id: `vault_legend:${day}`, label: `Vault Legend · ${opponent.name} · ${day}` };
      } else {
        xp = practiceToday < X.practiceRewardedPerDay ? (won ? X.practiceWin : X.practiceLoss) : 0;
      }
      const rewards = badge ? { xp, badge } : { xp };

      const ins = await c.query(
        `INSERT INTO battles (user_id, mode, tier, boss_id, seed, rules_version, lineup_instance_ids, player_lineup, opponent,
                              rounds, result, player_points, opponent_points, rewards, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [s.sub, body.mode, tier, bossId, seed, res.rulesVersion, body.lineup, JSON.stringify(player), JSON.stringify(opponent),
          JSON.stringify(res.rounds), res.result, res.playerPoints, res.opponentPoints, JSON.stringify(rewards), body.idempotencyKey],
      );
      const battleId = ins.rows[0].id;
      const clears = won && firstClear && tier ? [{ day, tier, battleId }] : [];
      const badges = badge ? [{ ...badge, battleId, earnedAt: new Date().toISOString() }] : [];
      await c.query(
        `INSERT INTO battle_progress (user_id, xp, wins, losses, vault_clears, badges) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id) DO UPDATE SET xp = battle_progress.xp + EXCLUDED.xp, wins = battle_progress.wins + EXCLUDED.wins,
           losses = battle_progress.losses + EXCLUDED.losses, vault_clears = battle_progress.vault_clears || EXCLUDED.vault_clears,
           badges = battle_progress.badges || EXCLUDED.badges, updated_at = now()`,
        [s.sub, xp, won ? 1 : 0, won ? 0 : 1, JSON.stringify(clears), JSON.stringify(badges)],
      );
      return { status: 201, row: ins.rows[0] };
    });
    return reply.code(out.status).send({ battle: toBattle(out.row, await playerName(pool, s.sub)) });
  });

  app.get("/battles/:id", async (req) => {
    const s = requireUser(req);
    const { id } = Id.parse(req.params);
    const r = await pool.query("SELECT * FROM battles WHERE id=$1 AND user_id=$2", [id, s.sub]);
    if (!r.rowCount) fail("NOT_FOUND", "Battle not found");
    return { battle: toBattle(r.rows[0], await playerName(pool, s.sub)) };
  });

  app.get("/me/battle-progress", async (req) => {
    const s = requireUser(req);
    const r = await pool.query("SELECT * FROM battle_progress WHERE user_id=$1", [s.sub]);
    const p = r.rows[0] ?? { xp: 0, wins: 0, losses: 0, vault_clears: [], badges: [] };
    const level = levelFor(p.xp);
    return {
      xp: p.xp,
      level,
      nextLevelXp: level * BATTLE_RULES.xp.perLevel,
      wins: p.wins,
      losses: p.losses,
      vaultClears: p.vault_clears,
      badges: p.badges,
    };
  });
}

