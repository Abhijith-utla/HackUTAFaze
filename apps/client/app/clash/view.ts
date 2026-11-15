// Pure view-model for a Card Clash match: everything the screens need, derived from the server's ClashState (the server is
// authoritative; this only reads it). Seats: you are `state.seat`, the opponent is the other one.
import type { ClashClip, ClashState } from '@faze/shared';

export type PlayCard = ClashClip & { instance_id: string; serial: number };
export type PipState = 'win' | 'loss' | 'draw' | 'current' | 'pending' | 'skipped';
export type Side = { card: ClashClip; score: number; matches: { tag: string; points: number }[] };
export type RoundResult = { number: number; title: string; description: string; weights: Record<string, number>; mine: Side | null; theirs: Side | null; winner: 'me' | 'opp' | 'draw' | null; tiebreak: { mine: number; theirs: number } | null };

export function derive(state: ClashState) {
  const me = state.seat, opp = me === 1 ? 2 : 1;
  const lineupOf = (seat: number) => state.lineups.filter((l) => l.seat === seat).sort((a, b) => a.slot - b.slot).map((l) => ({ ...l.snapshot, id: l.card_id }));
  const myLineup = lineupOf(me), oppLineup = lineupOf(opp);
  const myUsed: Record<string, number> = {}, oppUsed: Record<string, number> = {};
  for (const r of state.rounds) for (const s of r.submissions) (s.seat === me ? myUsed : oppUsed)[s.card_id] = r.number;
  const score = (seat: number) => state.players.find((p) => p.seat === seat)?.score ?? 0;
  const status = state.match.status;
  const pips: PipState[] = [1, 2, 3, 4, 5].map((n) => {
    const r = state.rounds.find((x) => x.number === n);
    if (r?.status === 'resolved') return r.winner_seat === me ? 'win' : r.winner_seat === opp ? 'loss' : 'draw';
    if (status === 'active' && n === state.match.current_round) return 'current';
    return status === 'completed' ? 'skipped' : 'pending';
  });
  const current = status === 'active' ? state.rounds.find((r) => r.number === state.match.current_round) ?? null : null;
  const outcome: 'win' | 'loss' | 'draw' | null = status !== 'completed' ? null : state.match.draw ? 'draw' : state.match.winner_seat === me ? 'win' : 'loss';
  return { me, opp, myLineup, oppLineup, myUsed, oppUsed, myScore: score(me), oppScore: score(opp), pips, current, outcome, status };
}

/** Both sides of a resolved round (or just yours while open). */
export function roundResult(state: ClashState, n: number): RoundResult | null {
  const r = state.rounds.find((x) => x.number === n);
  if (!r) return null;
  const me = state.seat, opp = me === 1 ? 2 : 1;
  const side = (seat: number): Side | null => {
    const s = r.submissions.find((x) => x.seat === seat);
    const l = s && state.lineups.find((x) => x.seat === seat && x.card_id === s.card_id);
    return s && l ? { card: { ...l.snapshot, id: s.card_id }, score: s.score ?? 0, matches: s.explanation ?? [] } : null;
  };
  const winner = r.status !== 'resolved' ? null : r.winner_seat === me ? 'me' : r.winner_seat === opp ? 'opp' : 'draw';
  // When both cards matched the prompt equally well the server breaks the tie on card power and records the two powers (seat 1, seat 2).
  const note = r.prompt_snapshot as unknown as { tiebreak?: string; powers?: [number, number] };
  const tiebreak = note.tiebreak === 'power' && note.powers ? { mine: note.powers[me - 1], theirs: note.powers[opp - 1] } : null;
  return { number: n, title: r.prompt_snapshot.title, description: r.prompt_snapshot.description, weights: r.prompt_snapshot.weights, mine: side(me), theirs: side(opp), winner, tiebreak };
}

/** The tags a prompt rewards, best first ("comeback +5"). */
export const weightList = (w: Record<string, number>) => Object.entries(w).sort((a, b) => b[1] - a[1]);
