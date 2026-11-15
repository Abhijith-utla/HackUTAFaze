// Demo seed (everything demo=true). Idempotent: safe to run many times.
// Uses D's catalog (content/seed/catalog.json, ids preserved) when present; otherwise the built-in sets below.
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Card, CardSet, Pack } from "@faze/shared";
import { z } from "zod";
import { storeArt } from "./art-store.js";
import { config } from "./config.js";
import { pool, tx } from "./db.js";
import { postEntry } from "./ledger.js";
import { migrate } from "./migrate.js";

type R = "common" | "rare" | "epic" | "legendary";
const POWER: Record<R, number> = { common: 20, rare: 45, epic: 70, legendary: 95 };
const SUPPLY: Record<R, number | null> = { common: null, rare: null, epic: 100, legendary: 25 };
const ODDS = { common: 70, rare: 20, epic: 8, legendary: 2 };

const SETS: { name: string; description: string; cards: [string, string, R][] }[] = [
  {
    name: "OG Era",
    description: "Trickshots, montages and the early FaZe days. Demo set.",
    cards: [
      ["First Trickshot", "FaZe Rain", "common"],
      ["Montage Drop", "FaZe Banks", "common"],
      ["Clip of the Week", "FaZe Apex", "common"],
      ["Sniper Lobby", "FaZe Rain", "common"],
      ["Basement Setup", "FaZe Banks", "common"],
      ["Feed Ladder", "FaZe Apex", "common"],
      ["Cross-map Hit", "FaZe Jev", "common"],
      ["The 360", "FaZe Apex", "common"],
      ["Collab Night", "FaZe Rain", "rare"],
      ["Founders' Pact", "FaZe Banks", "rare"],
      ["Ladder Stall", "FaZe Jev", "rare"],
      ["Original Logo", "FaZe Apex", "epic"],
      ["The First Clan", "FaZe Rain", "legendary"],
    ],
  },
  {
    name: "Creators",
    description: "Vlogs, challenges and FaZe House moments. Demo set.",
    cards: [
      ["Vlog Intro", "FaZe Rug", "common"],
      ["Challenge Accepted", "FaZe Adapt", "common"],
      ["House Tour", "FaZe Rug", "common"],
      ["Squad Stream", "FaZe Swagg", "common"],
      ["Unboxing", "FaZe Adapt", "common"],
      ["Late Night Lobby", "FaZe Swagg", "common"],
      ["Prank Gone Right", "FaZe Rug", "common"],
      ["Thumbnail Face", "FaZe Adapt", "common"],
      ["Viral Upload", "FaZe Rug", "rare"],
      ["Warzone Wins", "FaZe Swagg", "rare"],
      ["Subscriber Milestone", "FaZe Adapt", "rare"],
      ["Million Sub Plaque", "FaZe Rug", "epic"],
      ["House Legend", "FaZe Adapt", "legendary"],
    ],
  },
  {
    name: "Esports Moments",
    description: "Championship plays from FaZe pros. Demo set.",
    cards: [
      ["Entry Frag", "FaZe Snip3down", "common"],
      ["Clutch Defuse", "FaZe Snip3down", "common"],
      ["Scrim Grind", "FaZe Jev", "common"],
      ["Bootcamp", "FaZe Swagg", "common"],
      ["Comms Check", "FaZe Snip3down", "common"],
      ["Map Veto", "FaZe Jev", "common"],
      ["Overtime", "FaZe Snip3down", "common"],
      ["Opening Pick", "FaZe Jev", "common"],
      ["Bracket Run", "FaZe Snip3down", "rare"],
      ["1v3 Clutch", "FaZe Swagg", "rare"],
      ["Grand Final Ace", "FaZe Jev", "rare"],
      ["Championship Point", "FaZe Snip3down", "epic"],
      ["Trophy Lift", "FaZe Snip3down", "legendary"],
      ["Halo Legend", "FaZe Snip3down", "epic"],
    ],
  },
];

const art = (name: string) => `https://placehold.co/400x560/0b0b0b/e11d2e?text=${encodeURIComponent(name)}`;

async function upsertUser(email: string, password: string, name: string, role: "fan" | "admin") {
  return tx(async (c) => {
    const found = await c.query("SELECT id FROM users WHERE email=$1", [email]);
    let id: string;
    let created = false;
    if (found.rowCount) id = found.rows[0].id;
    else {
      const r = await c.query(
        "INSERT INTO users (email, password_hash, display_name, role, display_name_status, demo) VALUES ($1,$2,$3,$4,'approved',true) RETURNING id",
        [email, await bcrypt.hash(password, 10), name, role],
      );
      id = r.rows[0].id;
      created = true;
    }
    await postEntry(c, {
      userId: id,
      amount: 500,
      reason: "signup_bonus",
      refId: id,
      idempotencyKey: `signup_bonus:${id}`,
      demo: true,
    });
    return created;
  });
}

const Catalog = z.object({
  sets: z.array(CardSet),
  cards: z.array(Card),
  packs: z.array(Pack.extend({ active: z.boolean().default(true) })),
  cardStats: z.array(z.object({ cardId: z.string().uuid(), hype: z.number().int().min(0).max(100) })).default([]),
});

/**
 * v1.5: catalog art (`/demo-art/<file>.svg`) is imported into `card_art` and cards store the RELATIVE
 * `/art/<id>.svg`. Reads the trusted seed SVGs from DEMO_ART_DIR up front so a missing file fails the seed.
 */
const DEMO_ART = /^\/demo-art\/([A-Za-z0-9_-]+\.svg)$/;
async function loadSeedArt(cards: { id: string; artUrl: string }[]): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const k of cards) {
    if (!k.artUrl.startsWith("/demo-art/")) continue; // non-seed art (e.g. external) is kept as-is
    const m = DEMO_ART.exec(k.artUrl);
    if (!m) throw new Error(`catalog: card ${k.id} has an invalid demo art path ${k.artUrl}`);
    if (files.has(k.artUrl)) continue;
    try {
      files.set(k.artUrl, await readFile(path.join(config.demoArtDir, m[1])));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`catalog: card ${k.id} art ${k.artUrl} not found in ${config.demoArtDir}`);
      }
      throw e;
    }
  }
  return files;
}

async function importCatalog(counts: Record<string, number>): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(config.catalogPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  const cat = Catalog.parse(JSON.parse(raw));
  const setIds = new Set(cat.sets.map((s) => s.id));
  for (const c of cat.cards) if (!setIds.has(c.setId)) throw new Error(`catalog: card ${c.id} has unknown setId`);
  for (const p of cat.packs) {
    if (!setIds.has(p.setId)) throw new Error(`catalog: pack ${p.id} has unknown setId`);
    const sum = Object.values(p.odds).reduce((n, v) => n + (v ?? 0), 0);
    if (Math.abs(sum - 100) > 1e-9) throw new Error(`catalog: pack ${p.id} odds sum to ${sum}, not 100`);
  }
  const seedArt = await loadSeedArt(cat.cards);
  await tx(async (c) => {
    // Older built-in seed rows with the same set name but a different id would show twice in the store.
    const old = await c.query(
      "UPDATE card_sets SET status='retired' WHERE demo AND name = ANY($1) AND NOT (id = ANY($2::uuid[])) AND status <> 'retired' RETURNING id",
      [cat.sets.map((s) => s.name), [...setIds]],
    );
    if (old.rowCount) {
      await c.query("UPDATE packs SET active=false WHERE set_id = ANY($1::uuid[])", [old.rows.map((r) => r.id)]);
      console.log(`retired ${old.rowCount} older built-in demo set(s) replaced by the catalog`);
    }
    for (const s of cat.sets) {
      const r = await c.query(
        "INSERT INTO card_sets (id, name, description, status, demo, published_at) VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT (id) DO NOTHING",
        [s.id, s.name, s.description, s.status, s.publishedAt],
      );
      counts.sets += r.rowCount ?? 0;
    }
    // sha256 dedupe in storeArt keeps re-runs from adding card_art rows.
    const artUrl = new Map<string, string>();
    for (const [src, bytes] of seedArt) {
      artUrl.set(src, (await storeArt(c, { mime: "image/svg+xml", bytes, demo: true })).url);
    }
    let rewired = 0;
    for (const k of cat.cards) {
      const url = artUrl.get(k.artUrl) ?? k.artUrl;
      const r = await c.query(
        `INSERT INTO cards (id, set_id, name, faze_member, rarity, art_url, base_power, max_supply, demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT (id) DO NOTHING`,
        [k.id, k.setId, k.name, k.fazeMember, k.rarity, url, k.basePower, k.maxSupply],
      );
      counts.cards += r.rowCount ?? 0;
      if (url === k.artUrl) continue;
      // Existing rows still pointing at seed art (v1.4 absolute http://host/demo-art/..., the raw /demo-art/...
      // path, or an older imported /art/<id>.svg demo row) move to the relative DB-backed URL.
      // Art an admin replaced with something else is left alone.
      const u = await c.query(
        `UPDATE cards SET art_url=$2
         WHERE id=$1 AND art_url <> $2
           AND (art_url = $3 OR art_url LIKE '%' || $3
                OR art_url IN (SELECT '/art/' || id || '.svg' FROM card_art WHERE demo AND mime = 'image/svg+xml'))`,
        [k.id, url, k.artUrl],
      );
      rewired += u.rowCount ?? 0;
    }
    if (rewired) console.log(`moved ${rewired} card(s) to relative /art/ URLs`);
    const hype = new Map(cat.cardStats.map((x) => [x.cardId, x.hype]));
    for (const k of cat.cards) {
      await c.query("INSERT INTO card_stats (card_id, hype) VALUES ($1,$2) ON CONFLICT DO NOTHING", [k.id, hype.get(k.id) ?? 0]);
    }
    for (const p of cat.packs) {
      const r = await c.query(
        `INSERT INTO packs (id, set_id, name, price_coins, cards_per_pack, odds, odds_version, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.setId, p.name, p.priceCoins, p.cardsPerPack, p.odds, p.oddsVersion, p.active],
      );
      counts.packs += r.rowCount ?? 0;
    }
  });
  console.log(`catalog: ${config.catalogPath} (${cat.sets.length} sets, ${cat.cards.length} cards, ${cat.packs.length} packs)`);
  return true;
}

async function main() {
  await migrate();
  const counts = { users: 0, sets: 0, cards: 0, packs: 0 };

  if (await upsertUser("admin@demo.faze", "demo-admin-pass", "FaZe Admin (demo)", "admin")) counts.users++;
  for (let i = 1; i <= 4; i++) {
    if (await upsertUser(`fan${i}@demo.faze`, "demo-fan-pass", `DemoFan${i}`, "fan")) counts.users++;
  }

  const fromCatalog = await importCatalog(counts);
  for (const s of fromCatalog ? [] : SETS) {
    await tx(async (c) => {
      let setId: string;
      const found = await c.query("SELECT id FROM card_sets WHERE name=$1", [s.name]);
      if (found.rowCount) setId = found.rows[0].id;
      else {
        const r = await c.query(
          "INSERT INTO card_sets (name, description, status, demo, published_at) VALUES ($1,$2,'live',true,now()) RETURNING id",
          [s.name, s.description],
        );
        setId = r.rows[0].id;
        counts.sets++;
      }
      for (const [name, member, rarity] of s.cards) {
        const ex = await c.query("SELECT id FROM cards WHERE set_id=$1 AND name=$2", [setId, name]);
        let cardId: string;
        if (ex.rowCount) cardId = ex.rows[0].id;
        else {
          const r = await c.query(
            "INSERT INTO cards (set_id, name, faze_member, rarity, art_url, base_power, max_supply, demo) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id",
            [setId, name, member, rarity, art(name), POWER[rarity], SUPPLY[rarity]],
          );
          cardId = r.rows[0].id;
          counts.cards++;
        }
        await c.query("INSERT INTO card_stats (card_id, hype) VALUES ($1, 0) ON CONFLICT DO NOTHING", [cardId]);
      }
      const pk = await c.query("SELECT 1 FROM packs WHERE set_id=$1", [setId]);
      if (!pk.rowCount) {
        await c.query(
          "INSERT INTO packs (set_id, name, price_coins, cards_per_pack, odds, odds_version) VALUES ($1,$2,100,5,$3,1)",
          [setId, `${s.name} Pack`, ODDS],
        );
        counts.packs++;
      }
    });
  }

  console.log(
    `seed done (demo, ${fromCatalog ? "content/seed catalog" : "built-in sets"}): +${counts.users} users, +${counts.sets} sets, ` +
      `+${counts.cards} cards, +${counts.packs} packs. Logins: admin@demo.faze / demo-admin-pass, fan1-4@demo.faze / demo-fan-pass`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
