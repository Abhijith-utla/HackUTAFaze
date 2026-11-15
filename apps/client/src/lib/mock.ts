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

// ---- collection / social / trades / payments mocks ----
import type { Trade, LeaderboardResponse } from "@faze/shared";
import type { MyTradesResponse, SolBundle, SolCheckout, SolConfirm } from "./types";
const OTHER = { id: id(2), displayName: "Demo Rival" };
export async function userCards(_uid: string): Promise<CollectionResponse> {
  return { cards: CARDS.slice(0, 3).map((card, i) => ({ card, count: 1, instances: [{ id: id(700 + i), serial: i + 1, locked: false }] })) };
}
export async function card(cid: string) {
  const c = CARDS.find((x) => x.id === cid); if (!c) throw new ApiFailure("NOT_FOUND", "No such card", 404);
  return { card: c, stats: { hype: 40 + CARDS.indexOf(c) * 7 } };
}
export async function leaderboard(): Promise<LeaderboardResponse> {
  const s = load();
  return {
    collectors: [{ user: OTHER, score: 42 }, ...(s.user ? [{ user: { id: s.user.id, displayName: s.user.displayName }, score: s.owned.length }] : [])],
    trending: [...CARDS].reverse().slice(0, 5).map((c) => ({ card: c, hype: 40 + CARDS.indexOf(c) * 7 })),
  };
}
const TK = "faze_mock_trades";
const trades = (): Trade[] => JSON.parse(localStorage.getItem(TK) ?? "[]");
export async function myTrades(): Promise<MyTradesResponse> {
  const s = load(); const all = trades();
  return { outgoing: all.filter((t) => t.fromUser.id === s.user?.id), incoming: all.filter((t) => t.toUser.id === s.user?.id) };
}
export async function createTrade(b: { toUserId: string; offeredInstanceIds: string[]; requestedInstanceIds: string[]; message?: string }) {
  const s = load(); if (!s.user) throw new ApiFailure("UNAUTHENTICATED", "Not signed in", 401);
  const trade: Trade = { id: crypto.randomUUID(), fromUser: { id: s.user.id, displayName: s.user.displayName }, toUser: OTHER,
    offeredInstanceIds: b.offeredInstanceIds, requestedInstanceIds: b.requestedInstanceIds, message: b.message ?? null,
    messageStatus: b.message ? "pending" : null, status: "open", createdAt: new Date().toISOString(), resolvedAt: null };
  localStorage.setItem(TK, JSON.stringify([...trades(), trade])); return { trade };
}
export async function tradeAction(tid: string, a: "accept" | "decline" | "cancel") {
  const all = trades(); const t = all.find((x) => x.id === tid)!;
  t.status = a === "accept" ? "accepted" : a === "decline" ? "declined" : "cancelled"; t.resolvedAt = new Date().toISOString();
  localStorage.setItem(TK, JSON.stringify(all)); return { trade: t };
}
const BUNDLES: SolBundle[] = [{ id: "coins_1000", coins: 1000, lamports: 10_000_000 }, { id: "coins_2500", coins: 2500, lamports: 22_000_000 }];
export async function bundles() { return { bundles: BUNDLES }; }
export async function checkout(bundleId: string): Promise<SolCheckout> {
  return { purchaseId: bundleId, recipient: "", lamports: 0, reference: "", cluster: "devnet", solanaPayUrl: "" };
}
export async function confirm(bundleId: string): Promise<SolConfirm> {
  const s = load(); const coins = BUNDLES.find((b) => b.id === bundleId)?.coins ?? 0; s.balance += coins; save(s);
  return { status: "paid", credited: coins, balance: s.balance };
}
