import { RARITY_SCORE } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { toCard, toPublicUser } from "../mappers.js";

const WEIGHT = `CASE c.rarity WHEN 'legendary' THEN ${RARITY_SCORE.legendary} WHEN 'epic' THEN ${RARITY_SCORE.epic}
  WHEN 'rare' THEN ${RARITY_SCORE.rare} ELSE ${RARITY_SCORE.common} END`;

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard", async () => {
    const collectors = await pool.query(
      `SELECT u.id, u.display_name, u.display_name_status, SUM(${WEIGHT})::int AS score
         FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN users u ON u.id=ci.owner_id
        GROUP BY u.id ORDER BY score DESC, u.created_at ASC LIMIT 20`,
    );
    const trending = await pool.query(
      `SELECT c.*, cs.hype FROM card_stats cs JOIN cards c ON c.id=cs.card_id
         JOIN card_sets s ON s.id=c.set_id AND s.status='live'
        ORDER BY cs.hype DESC, cs.updated_at DESC LIMIT 10`,
    );
    return {
      collectors: collectors.rows.map((r) => ({ user: toPublicUser(r), score: r.score })),
      trending: trending.rows.map((r) => ({ card: toCard(r), hype: r.hype })),
    };
  });
}
