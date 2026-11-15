import type { CollectionEntry } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { pool } from "../db.js";
import { fail } from "../errors.js";
import { toCard } from "../mappers.js";

const RARITY_RANK = "CASE c.rarity WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1 WHEN 'rare' THEN 2 ELSE 3 END";

export async function collectionOf(userId: string): Promise<CollectionEntry[]> {
  const r = await pool.query(
    `SELECT c.*, ci.id AS ci_id, ci.serial, ci.locked_by_trade_id, ci.market_listing_id, ci.market_offer_id
       FROM card_instances ci JOIN cards c ON c.id = ci.card_id
       JOIN card_sets s ON s.id = c.set_id
      WHERE ci.owner_id = $1
      ORDER BY s.name, ${RARITY_RANK}, c.name, ci.serial`,
    [userId],
  );
  const out = new Map<string, CollectionEntry>();
  for (const row of r.rows) {
    let e = out.get(row.id);
    if (!e) {
      e = { card: toCard(row), instances: [], count: 0 };
      out.set(row.id, e);
    }
    e.instances.push({ id: row.ci_id, serial: row.serial, locked: row.locked_by_trade_id !== null || row.market_listing_id !== null || row.market_offer_id !== null });
    e.count++;
  }
  return [...out.values()];
}

export async function collectionRoutes(app: FastifyInstance) {
  app.get("/me/cards", async (req) => {
    const s = requireUser(req);
    return { cards: await collectionOf(s.sub) };
  });

  // v1.2 trade picker: approved display names only, prefix match, max 10, excludes the caller.
  app.get<{ Querystring: { q?: string } }>("/users", async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? "").trim().replace(/[\\%_]/g, (m) => "\\" + m);
    const r = await pool.query(
      `SELECT id, display_name FROM users
        WHERE display_name_status='approved' AND id <> $1 AND display_name ILIKE $2
        ORDER BY display_name LIMIT 10`,
      [me.sub, `${q}%`],
    );
    return { users: r.rows.map((u) => ({ id: u.id, displayName: u.display_name })) };
  });

  app.get<{ Params: { id: string } }>("/users/:id/collection", async (req) => {
    const u = await pool.query("SELECT id FROM users WHERE id=$1", [req.params.id]);
    if (!u.rowCount) fail("NOT_FOUND", "User not found");
    return { cards: await collectionOf(req.params.id) };
  });

  app.get<{ Params: { id: string } }>("/cards/:id", async (req) => {
    const r = await pool.query(
      "SELECT c.*, COALESCE(cs.hype,0) AS hype FROM cards c LEFT JOIN card_stats cs ON cs.card_id=c.id WHERE c.id=$1",
      [req.params.id],
    );
    const row = r.rows[0] ?? fail("NOT_FOUND", "Card not found");
    return { card: toCard(row), stats: { hype: row.hype } };
  });
}
