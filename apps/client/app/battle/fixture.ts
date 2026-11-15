// DEV ONLY: local battle fixture, used when the URL has ?battleMock=1 (before the API ships battles).
// Results here are made up in the browser and are NOT authoritative; the real flow always uses the server.
import type { Rarity } from '@faze/shared';
import type { Battle, BattleCard, BattleCardInfo, BattleProgress, BattleRound, BattleRules, BattleStat, CreateBattleBody, LineupCard, RoundSide, Slot, VaultBoss } from './types';

const SET = { og: 'd0000000-0000-4000-8000-000000000001', creators: 'd0000000-0000-4000-8000-000000000002', esports: 'd0000000-0000-4000-8000-000000000003' };
const BASE: Record<Rarity, number> = { common: 25, rare: 45, epic: 65, legendary: 85 };
const COST: Record<Rarity, number> = { common: 1, rare: 2, epic: 3, legendary: 4 };
const ROLE: Record<string, string> = { 'FaZe Apex': 'founder', 'FaZe Rain': 'og', 'FaZe Banks': 'creator', 'FaZe Adapt': 'creator', 'FaZe Rug': 'creator' };

function info(n: number, name: string, member: string, rarity: Rarity, setId: string): BattleCardInfo {
  const id = `d0000000-0000-4000-8000-00000000${String(1000 + n).padStart(4, '0')}`;
  return { id, name, fazeMember: member, rarity, artUrl: `/demo-art/${id}.svg`, basePower: BASE[rarity], setId };
}
function owned(i: number, card: BattleCardInfo, serial: number, s: [number, number, number, number]): BattleCard {
  return { instanceId: `mock-inst-${i}`, serial, card, stats: { power: s[0], clutch: s[1], style: s[2], hype: s[3], cost: COST[card.rarity], role: ROLE[card.fazeMember] ?? 'creator' } };
}

const CARDS: BattleCard[] = [
  owned(1, info(3, 'Rain / OG Era 3', 'FaZe Rain', 'epic', SET.og), 41, [64, 71, 63, 32]),
  owned(2, info(2, 'Apex / OG Era 2', 'FaZe Apex', 'rare', SET.og), 118, [48, 47, 44, 22]),
  owned(3, info(1, 'Banks / OG Era 1', 'FaZe Banks', 'common', SET.og), 902, [17, 21, 37, 12]),
  owned(4, info(8, 'Rain / OG Era 8', 'FaZe Rain', 'legendary', SET.og), 3, [81, 94, 87, 42]),
  owned(5, info(6, 'Banks / OG Era 6', 'FaZe Banks', 'rare', SET.og), 207, [38, 42, 62, 22]),
  owned(6, info(16, 'Apex / Creators 2', 'FaZe Apex', 'rare', SET.creators), 77, [52, 44, 37, 28]),
  owned(7, info(13, 'Rain / OG Era 13', 'FaZe Rain', 'common', SET.og), 1450, [20, 29, 24, 12]),
  owned(8, info(15, 'Banks / Creators 1', 'FaZe Banks', 'common', SET.creators), 611, [19, 22, 36, 18]),
];

function bossLine(v: number, cards: BattleCardInfo[]): LineupCard[] {
  return cards.map(card => ({ card, stats: { power: v, clutch: v + 4, style: v - 4, hype: v, cost: COST[card.rarity], role: ROLE[card.fazeMember] ?? 'creator' } }));
}
const BOSS_CARDS = [info(7, 'Apex / OG Era 7', 'FaZe Apex', 'epic', SET.og), info(11, 'Banks / OG Era 11', 'FaZe Banks', 'epic', SET.og), info(4, 'Adapt / OG Era 4', 'FaZe Adapt', 'legendary', SET.og)];
const TIERS: [VaultBoss['tier'], string, number, number | null][] = [[1, 'Vault Keeper · Rookie', 20, null], [2, 'Vault Keeper · Pro', 40, null], [3, 'Vault Keeper · Elite', 60, 9], [4, 'Vault Keeper · Legend', 78, 9]];
const XP = [50, 100, 200, 400];

const state = {
  vault: TIERS.map(([tier, name, v, costCap]) => ({ tier, name, lineup: bossLine(v, BOSS_CARDS), attemptsLeft: 3, cleared: false, costCap })) as VaultBoss[],
  progress: { xp: 350, level: 2, wins: 4, losses: 3, vaultClears: 2 } as BattleProgress,
  battles: new Map<string, Battle>(),
  byKey: new Map<string, string>(),
};

const RULES: BattleRules = {
  rulesVersion: 1,
  constants: { SWING: 60, TRICKSHOT: 12, TRICKSHOT_DIV: 400, CLUTCH_BASE: 6, CLUTCH_K: 0.3, ROUND_POINTS: [1, 1, 2], ERA_STACK: 6, ERA_PAIR: 3, FULL_SQUAD: 4, SQUAD_CAP: 9, VAULT_ATTEMPTS: 3 },
  roles: ROLE,
};

function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function synergy(lineup: LineupCard[]) {
  const out: { label: string; value: number }[] = [];
  const sets = new Map<string, number>();
  for (const c of lineup) sets.set(c.card.setId, (sets.get(c.card.setId) ?? 0) + 1);
  const top = Math.max(...sets.values());
  if (top === 3) out.push({ label: 'Era Stack', value: 6 }); else if (top === 2) out.push({ label: 'Era Pair', value: 3 });
  if (new Set(lineup.map(c => c.card.fazeMember)).size === 3) out.push({ label: 'Full Squad', value: 4 });
  return out;
}

/** Mock resolver. Forces one Trickshot and a round-3 Clutch so every mock replay shows both effects. */
function resolve(body: CreateBattleBody): Battle {
  const mine = body.lineup.map(id => CARDS.find(c => c.instanceId === id)!).filter(Boolean);
  const boss = state.vault.find(b => b.tier === (body.tier ?? 1)) ?? state.vault[0];
  const seed = Math.floor(Math.random() * 2 ** 31);
  const r = rng(seed);
  const pool: BattleStat[] = ['power', 'clutch', 'style', 'hype'];
  const calls = [0, 1, 2].map(() => pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const slots: Slot[] = ['opener', 'mid', 'closer'];
  const syn = { player: synergy(mine), opponent: synergy(boss.lineup) };
  let pp = 0, op = 0;
  const rounds2: BattleRound[] = [];
  const rounds: BattleRound[] = calls.map((stat, i) => {
    const side = (who: 'player' | 'opponent', card: LineupCard): RoundSide => {
      const base = card.stats[stat], bonusSum = syn[who].reduce((s, b) => s + b.value, 0), swing = Math.floor(r() * 61);
      const trick = (i === 1 && who === 'player') || r() < card.stats.style / 400 ? 12 : 0;
      return { cardIndex: i, base, bonuses: syn[who], swing, trickshot: trick || null, clutch: null, total: base + bonusSum + swing + trick };
    };
    const a = side('player', mine[i]), b = side('opponent', boss.lineup[i]);
    if (i === 2) {
      // Mock only: when level, the side that lost round 2 counts as behind, so every mock replay shows a Clutch.
      const playerBehind = pp < op || (pp === op && rounds2[1]?.winner === 'opponent');
      const behind = playerBehind ? a : b, card = playerBehind ? mine[i] : boss.lineup[i];
      const c = 6 + Math.floor(card.stats.hype * 0.3); behind.clutch = c; behind.total += c;
    }
    const pts = i === 2 ? 2 : 1, winner = a.total > b.total ? 'player' : b.total > a.total ? 'opponent' : 'tie';
    if (winner === 'player') pp += pts; else if (winner === 'opponent') op += pts;
    const round: BattleRound = { n: i + 1, slot: slots[i], stat, player: a, opponent: b, winner, points: pts };
    rounds2.push(round);
    return round;
  });
  const sum = (k: 'player' | 'opponent') => rounds.reduce((s, x) => s + x[k].total, 0);
  const result = pp > op || (pp === op && sum('player') >= sum('opponent')) ? 'win' : 'loss';
  const vault = body.mode === 'vault';
  const firstClear = vault && result === 'win' && !boss.cleared;
  return {
    id: `mock-battle-${state.battles.size + 1}`, mode: body.mode, tier: boss.tier, seed: seed.toString(16).padStart(8, '0'), createdAt: new Date().toISOString(),
    result, playerPoints: pp, opponentPoints: op,
    player: { name: 'You (mock)', lineup: mine }, opponent: { name: boss.name, lineup: boss.lineup }, rounds,
    rewards: { xp: firstClear ? XP[boss.tier - 1] : 0, badge: firstClear && boss.tier === 4 ? 'Vault Legend' : null },
  };
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function mockRequest<T>(path: string, body?: unknown): Promise<T> {
  await wait(250);
  if (path === '/battle/rules') return structuredClone(RULES) as T;
  if (path === '/me/battle-cards') return { cards: structuredClone(CARDS) } as T;
  if (path === '/battle/vault') return { bosses: structuredClone(state.vault) } as T;
  if (path === '/me/battle-progress') return { ...state.progress } as T;
  if (path.startsWith('/battles/')) { const b = state.battles.get(path.slice(9)); if (!b) throw new Error('Battle not found'); return { battle: b } as T; }
  if (path === '/battles') {
    const req = body as CreateBattleBody;
    const prior = state.byKey.get(req.idempotencyKey);
    if (prior) return { battle: state.battles.get(prior)! } as T;
    const boss = state.vault.find(b => b.tier === req.tier);
    if (req.mode === 'vault' && boss && boss.attemptsLeft <= 0) throw new Error('No attempts left today for this tier.');
    const battle = resolve(req);
    state.battles.set(battle.id, battle); state.byKey.set(req.idempotencyKey, battle.id);
    if (req.mode === 'vault' && boss) {
      boss.attemptsLeft -= 1;
      if (battle.result === 'win') { if (!boss.cleared) state.progress.vaultClears += 1; boss.cleared = true; }
    }
    if (req.mode === 'vault') { if (battle.result === 'win') state.progress.wins += 1; else state.progress.losses += 1; }
    state.progress.xp += battle.rewards.xp;
    state.progress.level = 1 + Math.floor(state.progress.xp / 250);
    return { battle } as T;
  }
  throw new Error(`Mock: no fixture for ${path}`);
}

/** Empty-collection fixture: ?battleMock=empty */
export async function mockEmptyRequest<T>(path: string, body?: unknown): Promise<T> {
  if (path === '/me/battle-cards') { await wait(150); return { cards: [] } as T; }
  return mockRequest<T>(path, body);
}
