import { ApiError, request } from '../../lib/api';
import type { Battle, BattleRules, CreateBattleBody, LineupCard } from './types';

/** ?battleMock=1 (or =empty) swaps in the local fixture. Dev builds only: production always talks to the API. */
export function mockMode(): '' | 'full' | 'empty' {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return '';
  const v = new URLSearchParams(window.location.search).get('battleMock');
  return v === 'empty' ? 'empty' : v ? 'full' : '';
}

export async function battleRequest<T>(path: string, body?: unknown): Promise<T> {
  const mock = mockMode();
  if (mock) {
    const fx = await import('./fixture');
    return mock === 'empty' ? fx.mockEmptyRequest<T>(path, body) : fx.mockRequest<T>(path, body);
  }
  return request<T>(path, body);
}

/** A fetch that never reached the server (offline, DNS, CORS, reset). Safe to retry with the same idempotency key. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError) && e instanceof TypeError;

/** POST /battles, retried on network errors only. The same key returns the same battle, so retries never double-fight. */
export async function createBattle(body: CreateBattleBody, attempts = 3): Promise<Battle> {
  let last: unknown;
  for (let n = 0; n < attempts; n++) {
    try { return (await battleRequest<{ battle: Battle }>('/battles', body)).battle; }
    catch (e) {
      last = e;
      if (!isNetworkError(e)) throw e;
      await new Promise(r => setTimeout(r, 400 * 2 ** n));
    }
  }
  throw last;
}

export interface RuleConstants { squadCap: number; eraStack: number; eraPair: number; fullSquad: number; trickshot: number; vaultAttempts: number; roundPoints: number[] }
const DEFAULTS: RuleConstants = { squadCap: 9, eraStack: 6, eraPair: 3, fullSquad: 4, trickshot: 12, vaultAttempts: 3, roundPoints: [1, 1, 2] };
const KEYS: Record<keyof RuleConstants, string[]> = {
  squadCap: ['SQUAD_CAP', 'squadCap'], eraStack: ['ERA_STACK', 'eraStack'], eraPair: ['ERA_PAIR', 'eraPair'], fullSquad: ['FULL_SQUAD', 'fullSquad'],
  trickshot: ['TRICKSHOT', 'trickshot'], vaultAttempts: ['VAULT_ATTEMPTS', 'vaultAttempts'], roundPoints: ['ROUND_POINTS', 'roundPoints'],
};
/** Reads constants from rules.constants or the top level, in SCREAMING_CASE or camelCase; falls back to rules v1. */
export function ruleConstants(rules: BattleRules | null): RuleConstants {
  const src = { ...(rules ?? {}), ...((rules?.constants as Record<string, unknown>) ?? {}) } as Record<string, unknown>;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const [k, names] of Object.entries(KEYS)) for (const name of names) {
    const v = src[name];
    if (k === 'roundPoints' ? Array.isArray(v) : typeof v === 'number') { out[k] = v; break; }
  }
  return out as unknown as RuleConstants;
}

/** Client-side preview of team bonuses. The server applies the real ones. */
export function teamBonuses(cards: (LineupCard | null)[], c: RuleConstants) {
  const filled = cards.filter((x): x is LineupCard => !!x);
  const sets = new Map<string, number>();
  for (const x of filled) sets.set(x.card.setId, (sets.get(x.card.setId) ?? 0) + 1);
  const top = Math.max(0, ...sets.values());
  const members = new Set(filled.map(x => x.card.fazeMember)).size;
  return [
    { key: 'stack', label: 'Era Stack', hint: '3 cards from one set', value: c.eraStack, on: top === 3 },
    { key: 'pair', label: 'Era Pair', hint: '2 cards from one set', value: c.eraPair, on: top === 2 },
    { key: 'squad', label: 'Full Squad', hint: '3 different members', value: c.fullSquad, on: filled.length === 3 && members === 3 },
  ];
}
