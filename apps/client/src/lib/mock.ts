// Dev-only stand-in for services/api (NEXT_PUBLIC_USE_MOCK=1). Mirrors docs/api.md shapes. Not authoritative.
import type { MeResponse, OpenPackResponse, Card, Rarity } from "@faze/shared";
import type { PacksResponse, CollectionResponse } from "./types";
import { ApiFailure } from "./api";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET = id(900);
const rarities: Rarity[] = ["common", "rare", "epic", "legendary"];
const CARDS: Card[] = Array.from({ length: 8 }, (_, i) => ({
  id: id(100 + i), setId: SET, name: `Demo Card ${i + 1}`, fazeMember: "Demo Member",
  rarity: rarities[Math.min(3, Math.floor(i / 2))], artUrl: "", basePower: 10 + i, maxSupply: null, demo: true,
}));
const PACK = { id: id(500), name: "Demo Pack", setId: SET, priceCoins: 100, cardsPerPack: 5,
  odds: { common: 70, rare: 22, epic: 7, legendary: 1 }, oddsVersion: 1 };

const KEY = "faze_mock";
type S = { user: MeResponse["user"] | null; balance: number; owned: { id: string; card: Card; serial: number }[] };
const load = (): S => JSON.parse(localStorage.getItem(KEY) ?? '{"user":null,"balance":0,"owned":[]}');
const save = (s: S) => localStorage.setItem(KEY, JSON.stringify(s));

const mkUser = (email: string, displayName: string) => ({
  id: id(1), email, displayName, displayNameStatus: "pending" as const, role: "fan" as const,
  demo: true, createdAt: new Date().toISOString(),
});

export async function signup(b: { email: string; displayName: string }) {
  const user = mkUser(b.email, b.displayName); save({ user, balance: 500, owned: [] }); return { user };
}
export async function login(b: { email: string }) {
  const s = load(); const user = s.user ?? mkUser(b.email, "Demo"); save({ ...s, user, balance: s.user ? s.balance : 500 }); return { user };
}
export async function logout() { const s = load(); save({ ...s, user: null }); }
export async function me(): Promise<MeResponse> {
  const s = load(); if (!s.user) throw new ApiFailure("UNAUTHENTICATED", "Not signed in", 401);
  return { user: s.user, balance: s.balance };
}
export async function packs(): Promise<PacksResponse> { return { packs: [PACK] }; }
export async function openPack(_id: string): Promise<OpenPackResponse> {
  const s = load(); if (!s.user) throw new ApiFailure("UNAUTHENTICATED", "Not signed in", 401);
  if (s.balance < PACK.priceCoins) throw new ApiFailure("INSUFFICIENT_COINS", "Not enough coins", 409);
  const cards = Array.from({ length: PACK.cardsPerPack }, () => {
    const r = Math.random() * 100; const rar: Rarity = r < 1 ? "legendary" : r < 8 ? "epic" : r < 30 ? "rare" : "common";
    const pool = CARDS.filter((c) => c.rarity === rar);
    const card = pool[Math.floor(Math.random() * pool.length)];
    const serial = s.owned.filter((o) => o.card.id === card.id).length + 1;
    const inst = { id: crypto.randomUUID(), card, serial }; s.owned.push(inst);
    return { id: inst.id, card, serial, locked: false, acquiredAt: new Date().toISOString() };
  });
  s.balance -= PACK.priceCoins; save(s);
  return { pullId: crypto.randomUUID(), cards, balance: s.balance };
}
export async function myCards(): Promise<CollectionResponse> {
  const by = new Map<string, CollectionResponse["cards"][number]>();
  for (const o of load().owned) {
    const e = by.get(o.card.id) ?? { card: o.card, instances: [], count: 0 };
    e.instances.push({ id: o.id, serial: o.serial, locked: false }); e.count++; by.set(o.card.id, e);
  }
  return { cards: [...by.values()] };
}
