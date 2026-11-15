// v1.9 moments game (lead-approved): era sets with checklists, free daily pack, one-time set claims.
// Everything here is server-authoritative: the client only renders what these routes return.
import { OpenPackBody } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { balanceOf, lockUser, postEntry } from "../ledger.js";
import { toCard } from "../mappers.js";
import { loadInstances, mintPull, toPack } from "./packs.js";

const DAY_MS = 86_400_000;
/** UTC calendar day, e.g. "2026-11-15". The daily pack resets at 00:00 UTC for everyone. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const nextReset = (now = Date.now()) => new Date((Math.floor(now / DAY_MS) + 1) * DAY_MS).toISOString();

/** Today's daily pack rotates through the live eras, one era per UTC day, the same for every fan. */
async function todaysDailyPack(db: pg.Pool | pg.PoolClient, now = Date.now()) {
  const r = await db.query(
    `SELECT p.*, s.name AS set_name FROM packs p JOIN card_sets s ON s.id = p.set_id
      WHERE p.kind = 'daily' AND p.active AND s.status = 'live' ORDER BY p.id`,
  );
  if (!r.rowCount) return null;
  return r.rows[Math.floor(now / DAY_MS) % r.rowCount];
}

async function setProgress(db: pg.Pool | pg.PoolClient, userId: string, setId?: string) {
  const r = await db.query(
    `SELECT s.id, s.backstory, s.completion_bonus,
            (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id)::int AS total,
            (SELECT COUNT(DISTINCT ci.card_id) FROM card_instances ci JOIN cards c ON c.id = ci.card_id
              WHERE c.set_id = s.id AND ci.owner_id = $1)::int AS owned,
            EXISTS (SELECT 1 FROM set_claims sc WHERE sc.set_id = s.id AND sc.user_id = $1) AS claimed
       FROM card_sets s
      WHERE s.status = 'live' AND ($2::uuid IS NULL OR s.id = $2::uuid)
      ORDER BY s.published_at NULLS LAST, s.name`,
    [userId, setId ?? null],
  );
  return r.rows.map((row) => {
    const complete = row.total > 0 && row.owned >= row.total;
    return {
      setId: row.id as string,
      owned: row.owned as number,
      total: row.total as number,
      complete,
      claimed: row.claimed as boolean,
      backstory: complete ? (row.backstory as string) : null,
      bonus: row.completion_bonus as number,
    };
  });
}

export async function gameRoutes(app: FastifyInstance) {
  /** Every live set with its full checklist, so fans can see which moments they are missing. */
  app.get("/sets", async () => {
    const sets = await pool.query(
      `SELECT s.*, EXISTS (SELECT 1 FROM campaigns k WHERE k.set_id = s.id) AS is_drop
         FROM card_sets s WHERE s.status = 'live' ORDER BY s.published_at NULLS LAST, s.name`,
    );
    const cards = await pool.query(
      `SELECT c.* FROM cards c JOIN card_sets s ON s.id = c.set_id WHERE s.status = 'live'
        ORDER BY c.moment_on NULLS LAST, c.name`,
    );
    return {
      sets: sets.rows
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          era: s.era ?? "",
          completionBonus: s.completion_bonus ?? 0,
          drop: s.is_drop,
          cards: cards.rows.filter((c) => c.set_id === s.id).map(toCard),
        }))
        .filter((s) => s.cards.length > 0),
    };
  });

  app.get("/me/sets", async (req) => {
    const s = requireUser(req);
    return { progress: (await setProgress(pool, s.sub)).map(({ bonus: _b, ...p }) => p) };
  });

  /** One-time completion reward. Ownership is re-checked under the user lock; replays return the same result. */
  app.post<{ Params: { id: string } }>("/me/sets/:id/claim", async (req) => {
    const s = requireUser(req);
    return tx(async (c) => {
      await lockUser(c, s.sub);
      const [p] = await setProgress(c, s.sub, req.params.id);
      if (!p) fail("NOT_FOUND", "Set not found");
      if (!p.complete) fail("VALIDATION", `Collect every moment first: you have ${p.owned} of ${p.total}.`);
      const backstory = p.backstory ?? "";
      if (p.claimed) return { setId: p.setId, bonus: 0, balance: await balanceOf(c, s.sub), backstory };
      await c.query("INSERT INTO set_claims (user_id, set_id, bonus) VALUES ($1,$2,$3)", [s.sub, p.setId, p.bonus]);
      let balance = await balanceOf(c, s.sub);
      if (p.bonus > 0) {
        balance = (await postEntry(c, {
          userId: s.sub,
          amount: p.bonus,
          reason: "set_bonus",
          refId: p.setId,
          idempotencyKey: `set_bonus:${s.sub}:${p.setId}`,
        })).balance;
      }
      return { setId: p.setId, bonus: p.bonus, balance, backstory };
    });
  });

  app.get("/me/daily", async (req) => {
    const s = requireUser(req);
    const pack = await todaysDailyPack(pool);
    const claimed = await pool.query("SELECT 1 FROM daily_claims WHERE user_id=$1 AND day=$2", [s.sub, utcDay()]);
    const available = !!pack && !claimed.rowCount;
    return {
      available,
      nextAt: available ? new Date().toISOString() : nextReset(),
      pack: pack ? toPack(pack) : null,
      setName: pack?.set_name ?? null,
    };
  });

  /** Free pack, once per UTC day. Same idempotency key → same pull; a second key the same day → 409. */
  app.post("/me/daily/open", async (req) => {
    const s = requireUser(req);
    const { idempotencyKey } = OpenPackBody.parse(req.body);
    const day = utcDay();
    return tx(async (c) => {
      await lockUser(c, s.sub);
      const prior = await c.query("SELECT pull_id, idempotency_key FROM daily_claims WHERE user_id=$1 AND day=$2", [s.sub, day]);
      if (prior.rowCount) {
        if (prior.rows[0].idempotency_key !== idempotencyKey) {
          fail("CONFLICT", `Today's free pack is already open. The next one unlocks at ${nextReset()}.`);
        }
        const pull = await c.query("SELECT p.*, s.name AS set_name FROM pulls u JOIN packs p ON p.id = u.pack_id JOIN card_sets s ON s.id = p.set_id WHERE u.id=$1", [prior.rows[0].pull_id]);
        const ids = (await c.query("SELECT card_instance_ids FROM pulls WHERE id=$1", [prior.rows[0].pull_id])).rows[0].card_instance_ids;
        return { pullId: prior.rows[0].pull_id, cards: await loadInstances(c, ids), balance: await balanceOf(c, s.sub), pack: toPack(pull.rows[0]), setName: pull.rows[0].set_name };
      }
      const pack = (await todaysDailyPack(c)) ?? fail("NOT_FOUND", "No daily pack is running right now");
      const { pullId, instanceIds } = await mintPull(c, s.sub, pack);
      await c.query("INSERT INTO daily_claims (user_id, day, pull_id, idempotency_key) VALUES ($1,$2,$3,$4)", [s.sub, day, pullId, idempotencyKey]);
      return { pullId, cards: await loadInstances(c, instanceIds), balance: await balanceOf(c, s.sub), pack: toPack(pack), setName: pack.set_name };
    });
  });
}
