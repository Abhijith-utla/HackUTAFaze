// Demo cards: 13 finished card faces (content/seed/demo-cards), one unique description per catalog card, and each demo pack's
// guaranteed slots (card 4 = the silver card, card 5 = a gold card; cards 1-3 are a normal mix). Idempotent.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { storeArt } from "./art-store.js";
import { config } from "./config.js";
import { tx } from "./db.js";

const dir = process.env.DEMO_CARDS_DIR || path.join(path.dirname(config.catalogPath), "demo-cards");
const POWER = { common: 25, rare: 45, epic: 70, legendary: 95 } as const;
const SET = { og: "d0000000-0000-4000-8000-000000000001", creators: "d0000000-0000-4000-8000-000000000002", esports: "d0000000-0000-4000-8000-000000000003" };
const idOf = (n: number) => `d0000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;

// Slot 4 is always the Silver card (The Hot Ones Challenge). Slot 5 is a gold card from that pack's era.
const SILVER = [idOf(2006)];
const GOLD: Record<string, { names: string; ids: string[] }> = {
  [SET.og]: { names: "Where It All Began, The First ILLCAM, The Million Club", ids: [idOf(2001), idOf(2002), idOf(2003)] },
  [SET.creators]: { names: "Welcome to the FaZe House, The FaZe Reboot, The Subathon Finale", ids: [idOf(2004), idOf(2012), idOf(2013)] },
  [SET.esports]: { names: "The 57-Elimination Squad, The Antwerp Major, The Million-Dollar Grand Slam", ids: [idOf(2008), idOf(2010), idOf(2011)] },
};

type Demo = {
  sets: { stream: { id: string; name: string; description: string } };
  special: { id: string; setId: string; name: string; tier: string; rarity: keyof typeof POWER; lore: string; voiceScript: string; art: string }[];
  lore: Record<string, string>;
  extraVoices?: { id: string; text: string }[];
};

export async function importDemoCards(counts: Record<string, number>): Promise<boolean> {
  let raw: string;
  try { raw = await readFile(path.join(dir, "demo-cards.json"), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  const demo = JSON.parse(raw) as Demo;
  const art = new Map<string, Buffer>();
  for (const s of demo.special) art.set(s.id, await readFile(path.join(dir, s.art)));

  await tx(async (c) => {
    const st = demo.sets.stream;
    await c.query(
      `INSERT INTO card_sets (id, name, description, status, demo, published_at) VALUES ($1,$2,$3,'live',true,now()) ON CONFLICT (id) DO NOTHING`,
      [st.id, st.name, st.description],
    );
    for (const s of demo.special) {
      const { url } = await storeArt(c, { mime: "image/webp", bytes: art.get(s.id)!, demo: true });
      const r = await c.query(
        `INSERT INTO cards (id, set_id, name, faze_member, rarity, art_url, base_power, max_supply, demo, lore, face_baked, voice_script, is_live_moment)
         VALUES ($1,$2,$3,'FaZe Clan',$4,$5,$6,NULL,true,$7,true,$8,$9)
         ON CONFLICT (id) DO UPDATE SET art_url=EXCLUDED.art_url, lore=EXCLUDED.lore, voice_script=EXCLUDED.voice_script, face_baked=true, rarity=EXCLUDED.rarity`,
        [s.id, s.setId, s.name, s.rarity, url, POWER[s.rarity], s.lore, s.voiceScript, s.setId === st.id],
      );
      counts.cards += r.rowCount ?? 0;
      await c.query("INSERT INTO card_stats (card_id, hype) VALUES ($1,60) ON CONFLICT DO NOTHING", [s.id]);
    }
    // Narration scripts for catalog Epic cards (audio lives in the client's public/voice).
    for (const v of demo.extraVoices ?? []) await c.query("UPDATE cards SET voice_script=$2 WHERE id=$1", [v.id, v.text]);
    // One unique description per catalog card.
    for (const [cardId, lore] of Object.entries(demo.lore)) await c.query("UPDATE cards SET lore=$2 WHERE id=$1", [cardId, lore]);

    // Guaranteed slots per demo pack (published with the pack: see toPack().guaranteed).
    for (const [setId, gold] of Object.entries(GOLD)) {
      const slots = [
        { slot: 4, label: "Silver card: The Hot Ones Challenge", cardIds: SILVER },
        { slot: 5, label: `Gold card, one of: ${gold.names}`, cardIds: gold.ids },
      ];
      await c.query("UPDATE packs SET fixed_slots=$2::jsonb, odds_version=2 WHERE set_id=$1", [setId, JSON.stringify(slots)]);
    }
  });
  console.log(`demo cards: ${demo.special.length} finished card faces, ${Object.keys(demo.lore).length} descriptions, 3 packs with guaranteed slots`);
  return true;
}
