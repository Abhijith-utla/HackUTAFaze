import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { signSession } from "../src/auth.js";
import { pool } from "../src/db.js";

export { pool };

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? "");
  return first.split(";")[0];
}

/** Signs up a fresh fan through the API. Returns user id + session cookie. */
export async function signup(app: FastifyInstance, name = "Tester") {
  const email = `t_${randomUUID()}@test.faze`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password: "password123", displayName: name },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed ${res.statusCode} ${res.body}`);
  return { id: res.json().user.id as string, email, cookie: cookieFrom(res) };
}

/** Creates an admin directly in the DB (admins exist only via seed). */
export async function makeAdmin() {
  const r = await pool.query(
    "INSERT INTO users (email, password_hash, display_name, role, display_name_status, demo) VALUES ($1,'x','Admin','admin','approved',true) RETURNING id",
    [`admin_${randomUUID()}@test.faze`],
  );
  const id = r.rows[0].id as string;
  return { id, cookie: `session=${signSession(id, "admin")}` };
}

/** Creates a live set with cards + a pack directly in the DB. */
export async function makeSetWithPack(opts?: {
  price?: number;
  perPack?: number;
  odds?: Record<string, number>;
  cards?: { rarity: string; maxSupply?: number | null }[];
}) {
  const set = await pool.query(
    "INSERT INTO card_sets (name, status, demo, published_at) VALUES ($1,'live',true,now()) RETURNING id",
    [`Set ${randomUUID().slice(0, 6)}`],
  );
  const setId = set.rows[0].id as string;
  const specs = opts?.cards ?? [
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "rare" },
    { rarity: "epic" },
    { rarity: "legendary" },
  ];
  const cardIds: string[] = [];
  for (const [i, s] of specs.entries()) {
    const c = await pool.query(
      "INSERT INTO cards (set_id, name, faze_member, rarity, art_url, base_power, max_supply, demo) VALUES ($1,$2,$3,$4,'https://example.test/a.png',10,$5,true) RETURNING id",
      [setId, `Card ${i}`, `Member${i % 3}`, s.rarity, s.maxSupply ?? null],
    );
    cardIds.push(c.rows[0].id);
  }
  const pack = await pool.query(
    "INSERT INTO packs (set_id, name, price_coins, cards_per_pack, odds, odds_version) VALUES ($1,'Test Pack',$2,$3,$4,1) RETURNING id",
    [setId, opts?.price ?? 100, opts?.perPack ?? 5, opts?.odds ?? { common: 70, rare: 20, epic: 8, legendary: 2 }],
  );
  return { setId, cardIds, packId: pack.rows[0].id as string };
}
