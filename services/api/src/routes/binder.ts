// Binder: eras -> sets -> cards, with cards you don't own included (owned: 0) so the client can show them as teasers.
// Read-only. Reads the caller's own instances only.
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { pool } from "../db.js";
import { toCard } from "../mappers.js";

const RARITY_RANK = "CASE c.rarity WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1 WHEN 'rare' THEN 2 ELSE 3 END";

export async function binderRoutes(app: FastifyInstance) {
  app.get("/binder", async (req) => {
    const s = requireUser(req);
    const [erasR, cardsR, instR] = await Promise.all([
      pool.query("SELECT * FROM eras ORDER BY sort"),
      pool.query(
        `SELECT c.*, st.name AS set_name, st.status AS set_status, st.era_id AS set_era,
                (SELECT e.name FROM eras e WHERE e.id = st.era_id) AS era_name
           FROM cards c JOIN card_sets st ON st.id = c.set_id
          WHERE NOT c.is_live_moment
            AND (st.status = 'live' OR EXISTS (SELECT 1 FROM card_instances ci JOIN cards y ON y.id = ci.card_id WHERE y.set_id = st.id AND ci.owner_id = $1))
          ORDER BY st.name, ${RARITY_RANK}, c.name`,
        [s.sub],
      ),
      pool.query("SELECT id, card_id, serial, acquired_via, tradable_after FROM card_instances WHERE owner_id = $1 ORDER BY serial", [s.sub]),
    ]);

    const byCard = new Map<string, { id: string; serial: number; acquiredVia: string; tradableAfter: string | null }[]>();
    for (const i of instR.rows) {
      const list = byCard.get(i.card_id) ?? [];
      list.push({ id: i.id, serial: i.serial, acquiredVia: i.acquired_via, tradableAfter: i.tradable_after ? new Date(i.tradable_after).toISOString() : null });
      byCard.set(i.card_id, list);
    }

    const sets = new Map<string, any>();
    for (const row of cardsR.rows) {
      let set = sets.get(row.set_id);
      if (!set) {
        set = { id: row.set_id, name: row.set_name, status: row.set_status, eraId: row.set_era, total: 0, owned: 0, complete: false, cards: [] };
        sets.set(row.set_id, set);
      }
      const instances = byCard.get(row.id) ?? [];
      set.total++;
      if (instances.length) set.owned++;
      set.cards.push({
        card: { ...toCard(row), lore: row.lore ?? "", era: row.set_era ? { id: row.set_era, name: row.era_name ?? row.set_era } : null },
        owned: instances.length,
        instances,
      });
    }
    for (const set of sets.values()) set.complete = set.total > 0 && set.owned === set.total;

    const eras = erasR.rows.map((e) => ({
      id: e.id, name: e.name, starts: e.starts, ends: e.ends,
      sets: [...sets.values()].filter((x) => x.eraId === e.id).map(({ eraId, ...x }) => x),
    }));
    // Sets with no era (the original demo sets) go under a synthetic "Classic" era so nothing a fan owns is hidden.
    const classic = [...sets.values()].filter((x) => !x.eraId).map(({ eraId, ...x }) => x);
    if (classic.length) eras.push({ id: "classic", name: "Classic", starts: null, ends: null, sets: classic });
    return { eras };
  });
}
