// Battle API shapes, local to the client until the contract (packages/shared) carries them.
// TODO(@Abhijith-utla): replace with @faze/shared types once contract v1.9 lands.
import type { Rarity } from '@faze/shared';

export type BattleStat = 'power' | 'clutch' | 'style' | 'hype';
export type BattleRole = 'founder' | 'og' | 'creator' | 'pro' | (string & {});
export type Slot = 'opener' | 'mid' | 'closer';
export const SLOTS: Slot[] = ['opener', 'mid', 'closer'];
export const STATS: BattleStat[] = ['power', 'clutch', 'style', 'hype'];

export interface BattleCardInfo {
  id: string;
  name: string;
  fazeMember: string;
  rarity: Rarity;
  artUrl: string;
  basePower: number;
  setId: string;
}

export interface BattleStats {
  power: number;
  clutch: number;
  style: number;
  hype: number;
  cost: number;
  role: BattleRole;
}

/** GET /me/battle-cards → cards[] */
export interface BattleCard {
  instanceId: string;
  serial: number;
  card: BattleCardInfo;
  stats: BattleStats;
}

/** Opponent cards have no instance (boss or ghost snapshot). */
export interface LineupCard {
  instanceId?: string;
  serial?: number;
  card: BattleCardInfo;
  stats: BattleStats;
}

export interface VaultBoss {
  tier: 1 | 2 | 3 | 4;
  name: string;
  lineup: LineupCard[];
  attemptsLeft: number;
  cleared: boolean;
  costCap?: number | null;
}

export interface BattleRules {
  rulesVersion?: number;
  version?: number;
  constants?: Record<string, unknown>;
  roles?: Record<string, BattleRole>;
  [key: string]: unknown;
}

export interface BattleProgress {
  xp: number;
  level: number;
  wins: number;
  losses: number;
  vaultClears: number;
}

export interface RoundSide {
  cardIndex: number;
  base: number;
  bonuses: { label: string; value: number }[];
  swing: number;
  /** Bonus added by a Trickshot (number) or a flag; falsy when none. */
  trickshot: number | boolean | null;
  /** Bonus added by the round-3 Clutch surge (number) or a flag; falsy when none. */
  clutch: number | boolean | null;
  total: number;
}

export interface BattleRound {
  n: number;
  slot: Slot;
  stat: BattleStat;
  player: RoundSide;
  opponent: RoundSide;
  winner: 'player' | 'opponent' | 'tie';
  points: number;
}

export interface Battle {
  id: string;
  mode: 'vault' | 'practice' | 'ranked';
  tier: number | null;
  seed: string;
  createdAt: string;
  result: 'win' | 'loss';
  playerPoints: number;
  opponentPoints: number;
  player: { name: string; lineup: LineupCard[] };
  opponent: { name: string; lineup: LineupCard[] };
  rounds: BattleRound[];
  rewards: { xp: number; badge?: string | null };
}

export interface CreateBattleBody {
  mode: 'vault' | 'practice';
  tier?: number;
  lineup: string[];
  idempotencyKey: string;
}
