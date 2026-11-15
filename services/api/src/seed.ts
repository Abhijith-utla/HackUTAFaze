// Demo seed (everything demo=true). Idempotent: safe to run many times.
// TODO(@tanejakeshav): switch to content/seed/ once D's seed files land.
import bcrypt from "bcryptjs";
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

async function main() {
  await migrate();
  const counts = { users: 0, sets: 0, cards: 0, packs: 0 };

  if (await upsertUser("admin@demo.faze", "demo-admin-pass", "FaZe Admin (demo)", "admin")) counts.users++;
  for (let i = 1; i <= 4; i++) {
    if (await upsertUser(`fan${i}@demo.faze`, "demo-fan-pass", `DemoFan${i}`, "fan")) counts.users++;
  }

  for (const s of SETS) {
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

  const total = SETS.reduce((n, s) => n + s.cards.length, 0);
  console.log(
    `seed done (demo): +${counts.users} users, +${counts.sets} sets, +${counts.cards} cards, +${counts.packs} packs ` +
      `(catalog: 5 users, ${SETS.length} sets, ${total} cards). Logins: admin@demo.faze / demo-admin-pass, fan1-4@demo.faze / demo-fan-pass`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
