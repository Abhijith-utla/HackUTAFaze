// Three-Lane Showdown resolver (design §2a), ported from scratchpad sim.py `battle()`.
// Pure and deterministic: same seed + same lineups → identical log. RNG draw order matters for
// replays: 3 stat calls first, then per round player (swing, trickshot) then opponent (swing, trickshot).
import { BATTLE_RULES, type StatKey } from "./rules.js";
import { rngFromSeed } from "./rng.js";

export interface Fighter {
  /** Set identity for Era Stack / Era Pair (vault bosses share one key). */
  setKey: string;
  /** Member identity for Full Squad. */
  member: string;
  stats: { power: number; clutch: number; style: number; hype: number };
}

export interface Bonus {
  label: string;
  value: number;
}

export interface SideRoll {
  cardIndex: number;
  base: number;
  bonuses: Bonus[]; // team synergies (apply to every round)
  swing: number;
  trickshot: boolean; // +trickshotBonus when true
  clutch: number; // round-3 comeback bonus, 0 if none
  total: number;
}

export type Slot = (typeof BATTLE_RULES.slots)[number];

export interface Round {
  n: 1 | 2 | 3;
  slot: Slot;
  stat: StatKey;
  player: SideRoll;
  opponent: SideRoll;
  winner: "player" | "opponent" | "tie";
  points: number; // points awarded this round (0 on a tie)
  score: { player: number; opponent: number }; // running points after this round
}

export interface Resolution {
  rulesVersion: number;
  rounds: Round[];
  playerSynergy: Bonus[];
  opponentSynergy: Bonus[];
  playerPoints: number;
  opponentPoints: number;
  playerTotal: number;
  opponentTotal: number;
  /** true when points were tied and total score decided it (ties on total go to the player/challenger). */
  decidedByTotal: boolean;
  result: "win" | "loss";
}

export function synergy(team: Fighter[]): Bonus[] {
  const counts = new Map<string, number>();
  for (const f of team) counts.set(f.setKey, (counts.get(f.setKey) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const out: Bonus[] = [];
  if (top === 3) out.push({ label: "ERA STACK", value: BATTLE_RULES.eraStack });
  else if (top === 2) out.push({ label: "ERA PAIR", value: BATTLE_RULES.eraPair });
  if (new Set(team.map((f) => f.member)).size === 3) out.push({ label: "FULL SQUAD", value: BATTLE_RULES.fullSquad });
  return out;
}

export function resolve(seed: string, player: Fighter[], opponent: Fighter[]): Resolution {
  if (player.length !== 3 || opponent.length !== 3) throw new Error("lineups must have exactly 3 cards");
  const R = BATTLE_RULES;
  const rng = rngFromSeed(seed);

  const pool: StatKey[] = [...R.statCalls];
  const calls: StatKey[] = [];
  for (let i = 0; i < 3; i++) calls.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);

  const teams = [player, opponent];
  const syn = [synergy(player), synergy(opponent)];
  const synSum = syn.map((b) => b.reduce((s, x) => s + x.value, 0));
  const pts = [0, 0];
  const tot = [0, 0];
  const rounds: Round[] = [];

  for (let r = 0; r < 3; r++) {
    const rolls: SideRoll[] = [];
    for (let side = 0; side < 2; side++) {
      const f = teams[side][r];
      const base = f.stats[calls[r]];
      const swing = rng.int(0, R.swing);
      const trickshot = rng.chance(f.stats.style / R.trickshotDiv);
      const clutch = r === 2 && pts[side] < pts[1 - side] ? R.clutchBase + Math.floor(f.stats.hype * R.clutchK) : 0;
      const total = base + synSum[side] + swing + (trickshot ? R.trickshotBonus : 0) + clutch;
      rolls.push({ cardIndex: r, base, bonuses: syn[side], swing, trickshot, clutch, total });
    }
    const w = rolls[0].total > rolls[1].total ? 0 : rolls[1].total > rolls[0].total ? 1 : -1;
    const points = w === -1 ? 0 : R.roundPoints[r];
    if (w !== -1) pts[w] += points;
    tot[0] += rolls[0].total;
    tot[1] += rolls[1].total;
    rounds.push({
      n: (r + 1) as 1 | 2 | 3,
      slot: R.slots[r],
      stat: calls[r],
      player: rolls[0],
      opponent: rolls[1],
      winner: w === 0 ? "player" : w === 1 ? "opponent" : "tie",
      points,
      score: { player: pts[0], opponent: pts[1] },
    });
  }

  const decidedByTotal = pts[0] === pts[1];
  const win = decidedByTotal ? tot[0] >= tot[1] : pts[0] > pts[1];
  return {
    rulesVersion: R.version,
    rounds,
    playerSynergy: syn[0],
    opponentSynergy: syn[1],
    playerPoints: pts[0],
    opponentPoints: pts[1],
    playerTotal: tot[0],
    opponentTotal: tot[1],
    decidedByTotal,
    result: win ? "win" : "loss",
  };
}
