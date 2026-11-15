import { mkdir, writeFile } from "node:fs/promises";
const dir = new URL("./", import.meta.url);
const uuid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const themes = [
  ["OG Era", "#dc2626"],
  ["Creators", "#7c3aed"],
  ["Esports Moments", "#0284c7"],
];
const members = [
  "FaZe Banks",
  "FaZe Apex",
  "FaZe Rain",
  "FaZe Adapt",
  "FaZe Rug",
];
const rarities = ["common", "rare", "epic", "legendary"];
const sets = [],
  cards = [],
  packs = [];
await mkdir(new URL("art/", dir), { recursive: true });
for (const [index, [name, color]] of themes.entries()) {
  const setId = uuid(index + 1);
  sets.push({
    id: setId,
    name,
    description: `${name}: fictional demo collectibles with original geometric art.`,
    status: "live",
    demo: true,
    publishedAt: "2026-11-15T00:00:00Z",
  });
  packs.push({
    id: uuid(101 + index),
    setId,
    name: `${name} Demo Pack`,
    priceCoins: 100,
    cardsPerPack: 5,
    odds: { common: 70, rare: 20, epic: 8, legendary: 2 },
    oddsVersion: 1,
    active: true,
  });
  for (let i = 0; i < (index === 0 ? 14 : 13); i++) {
    const n = cards.length + 1,
      id = uuid(1000 + n),
      rarity = rarities[i % 4],
      member = members[i % 5];
    cards.push({
      id,
      setId,
      name: `${member.replace("FaZe ", "")} / ${name} ${i + 1}`,
      fazeMember: member,
      rarity,
      artUrl: `/demo-art/${id}.svg`,
      basePower: 25 + (i % 4) * 20,
      maxSupply: rarity === "legendary" ? 25 : rarity === "epic" ? 100 : null,
      demo: true,
    });
    await writeFile(
      new URL(`art/${id}.svg`, dir),
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840"><rect width="600" height="840" rx="30" fill="#101014"/><path d="M40 200 560 80 440 560 100 660Z" fill="${color}"/><path d="M${70 + i * 10} 180 490 580M130 150 520 520" stroke="white" opacity=".25" stroke-width="20"/><circle cx="300" cy="350" r="110" fill="none" stroke="white" stroke-width="10"/><text x="300" y="378" text-anchor="middle" fill="white" font-family="sans-serif" font-size="80">${n}</text><text x="45" y="710" fill="white" font-family="sans-serif" font-size="34">${member}</text><text x="45" y="755" fill="#ddd" font-family="sans-serif" font-size="22">${name} / ${rarity.toUpperCase()}</text><text x="45" y="800" fill="#aaa" font-family="sans-serif" font-size="16">DEMO - ORIGINAL GEOMETRIC PLACEHOLDER</text></svg>\n`,
    );
  }
}
await writeFile(
  new URL("catalog.json", dir),
  JSON.stringify(
    {
      demo: true,
      sets,
      cards,
      packs,
      cardStats: cards.map((c) => ({ cardId: c.id, hype: 0 })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Generated ${cards.length} original demo cards.`);
