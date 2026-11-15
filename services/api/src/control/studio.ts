// Moment Studio: turns an archive moment into card drafts + lore, with duplicate detection.
// Default writer is deterministic and grounded only in the archive text ("template"); if OLLAMA_URL
// is set, lore is rewritten by a local model and falls back to the template on any error.
import type { Rarity } from "@faze/shared";

export type Draft = {
  position: number;
  name: string;
  fazeMember: string;
  rarity: Rarity;
  lore: string;
  artUrl: string;
  basePower: number;
  maxSupply: number | null;
};
type Moment = { title: string; summary: string; members: string[]; occurredOn: string; source: string };

const PLAN: { rarity: Rarity; angle: string; power: number; supply: number | null }[] = [
  { rarity: "common", angle: "Origin", power: 22, supply: null },
  { rarity: "common", angle: "Crowd", power: 26, supply: null },
  { rarity: "rare", angle: "Highlight", power: 38, supply: null },
  { rarity: "epic", angle: "Signature", power: 57, supply: 250 },
  { rarity: "legendary", angle: "Legend", power: 82, supply: 50 },
];

export function shortTitle(title: string, max = 26): string {
  const t = title.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, max)).trim();
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

/** Deterministic, archive-grounded drafts. Never invents facts: lore is the moment's own sentences. */
export function templateDrafts(m: Moment, artFor: (member: string, i: number) => string): Draft[] {
  const members = m.members.length ? m.members : ["Clan"];
  const year = m.occurredOn.slice(0, 4);
  const base = shortTitle(m.title);
  const lines = sentences(m.summary);
  return PLAN.map((p, i) => {
    const member = members[i % members.length];
    const lore = clip(lines[i % Math.max(1, lines.length)] ?? m.summary, 220) + ` (${year} · ${m.source.replace(/^.*\(PDF\),\s*/, "PDF ")})`;
    return {
      position: i,
      name: clip(`${member} / ${base} · ${p.angle}`, 80),
      fazeMember: `FaZe ${member}`,
      rarity: p.rarity,
      lore,
      artUrl: artFor(member, i),
      basePower: p.power,
      maxSupply: p.supply,
    };
  });
}

/** Optional local-model rewrite of lore (Ollama). Returns null on any failure → caller keeps template. */
export async function ollamaLore(m: Moment, drafts: Draft[], fetchImpl: typeof fetch = fetch): Promise<{ model: string; lore: string[] } | null> {
  const url = process.env.OLLAMA_URL, model = process.env.OLLAMA_MODEL || "llama3.2";
  if (!url) return null;
  try {
    const prompt = `You write one-sentence collectible card lore. Use ONLY facts from this archive entry; no new facts, numbers or quotes.\nEntry (${m.occurredOn}): ${m.title}. ${m.summary}\nReturn JSON {"lore": [5 strings]} for cards: ${drafts.map((d) => `${d.rarity} "${d.name}"`).join("; ")}.`;
    const r = await fetchImpl(`${url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const lore = JSON.parse((await r.json()).response)?.lore;
    if (!Array.isArray(lore) || lore.length < drafts.length || lore.some((x: unknown) => typeof x !== "string" || !x.trim())) return null;
    return { model, lore: lore.slice(0, drafts.length).map((s: string) => clip(s.trim(), 260)) };
  } catch {
    return null;
  }
}

// ---------- duplicate detection ----------
const norm = (s: string) =>
  s.toLowerCase().replace(/^faze\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${norm(s)} `;
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
  return m;
}
/** Sørensen–Dice similarity on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [k, n] of A) { inter += Math.min(n, B.get(k) ?? 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}
export const DUPLICATE_THRESHOLD = 0.82;

export function findDuplicate(name: string, member: string, existing: { id: string; name: string; fazeMember: string }[]) {
  let best: { id: string; similarity: number } | null = null;
  for (const c of existing) {
    const s = similarity(name, c.name) * (norm(c.fazeMember) === norm(member) ? 1 : 0.9);
    if (!best || s > best.similarity) best = { id: c.id, similarity: Math.round(s * 1000) / 1000 };
  }
  return best && best.similarity >= DUPLICATE_THRESHOLD ? best : null;
}

/** Pack odds for a campaign pack: only rarities the drop actually contains, summing to 100. */
export function campaignOdds(rarities: Rarity[]): Record<string, number> {
  const base: Record<Rarity, number> = { common: 62, rare: 24, epic: 10, legendary: 4 };
  const present = (Object.keys(base) as Rarity[]).filter((r) => rarities.includes(r));
  const sum = present.reduce((a, r) => a + base[r], 0);
  const odds: Record<string, number> = {};
  let acc = 0;
  present.forEach((r, i) => {
    const v = i === present.length - 1 ? 100 - acc : Math.round((base[r] / sum) * 100);
    odds[r] = v;
    acc += v;
  });
  return odds;
}
