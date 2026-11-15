// Run with: cd apps/client && npx tsx --test app/clash/view.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ClashState } from '@faze/shared';
import { derive, roundResult, weightList } from './view';

const snap = (id: string, tags: string[] = []) => ({ id, name: id.toUpperCase(), art_url: `/art/${id}.png`, moment_tags: tags, clip_asset_id: null, thumbnail_asset_id: null, clip_start_ms: null, clip_end_ms: null, moment_description: null });
const lineup = (seat: number, ids: string[]) => ids.map((id, i) => ({ seat, slot: i + 1, card_id: id, snapshot: snap(id, [id]) }));
const W = { clutch: 5, precision: 2 };
function base(over: Partial<ClashState['match']> = {}): ClashState {
  return {
    match: { id: 'm1', invite_code: null, status: 'active', mode: 'cpu', current_round: 1, winner_seat: null, draw: false, ...over }, seat: 1,
    players: [{ seat: 1, cpu: false, score: 0, ready_at: 'x' }, { seat: 2, cpu: true, score: 0, ready_at: 'x' }],
    lineups: [...lineup(1, ['a1', 'a2', 'a3', 'a4', 'a5']), ...lineup(2, ['b1', 'b2', 'b3', 'b4', 'b5'])],
    rounds: [{ number: 1, status: 'open', winner_seat: null, prompt_snapshot: { title: 'Clutch', description: 'Deliver under pressure.', weights: W }, submissions: [] }],
  } as ClashState;
}

test('fresh match: round 1 is current, nothing used, scores 0', () => {
  const v = derive(base());
  assert.deepEqual(v.pips, ['current', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(v.myLineup.length, 5); assert.equal(v.oppLineup.length, 5);
  assert.deepEqual(v.myUsed, {}); assert.equal(v.outcome, null); assert.equal(v.current?.number, 1);
});

test('a resolved round: pips, used cards, scores, and both sides with explanations', () => {
  const s = base({ current_round: 2 });
  s.rounds = [
    { number: 1, status: 'resolved', winner_seat: 1, prompt_snapshot: { title: 'Clutch', description: 'd', weights: W }, submissions: [
      { seat: 1, card_id: 'a2', score: 7, explanation: [{ tag: 'clutch', points: 5 }, { tag: 'precision', points: 2 }] }, { seat: 2, card_id: 'b3', score: 2, explanation: [{ tag: 'precision', points: 2 }] }] },
    { number: 2, status: 'open', winner_seat: null, prompt_snapshot: { title: 'Comeback', description: 'd', weights: { comeback: 5 } }, submissions: [] },
  ] as ClashState['rounds'];
  s.players[0].score = 1;
  const v = derive(s);
  assert.deepEqual(v.pips, ['win', 'current', 'pending', 'pending', 'pending']);
  assert.deepEqual(v.myUsed, { a2: 1 }); assert.deepEqual(v.oppUsed, { b3: 1 });
  assert.equal(v.myScore, 1); assert.equal(v.oppScore, 0);
  const r = roundResult(s, 1)!;
  assert.equal(r.winner, 'me'); assert.equal(r.mine!.score, 7); assert.equal(r.theirs!.score, 2);
  assert.deepEqual(r.mine!.matches.map((m) => m.tag), ['clutch', 'precision']);
  assert.equal(roundResult(s, 2)!.winner, null);
});

test('loss and draw pips; completed match: outcome and skipped rounds', () => {
  const s = base({ status: 'completed', current_round: 3, winner_seat: 2 });
  s.rounds = [1, 2, 3].map((n) => ({ number: n, status: 'resolved', winner_seat: n === 2 ? null : 2, prompt_snapshot: { title: 't', description: 'd', weights: W }, submissions: [] })) as ClashState['rounds'];
  s.players[1].score = 2;
  const v = derive(s);
  assert.deepEqual(v.pips, ['loss', 'draw', 'loss', 'skipped', 'skipped']);
  assert.equal(v.outcome, 'loss');
  assert.equal(derive(base({ status: 'completed', winner_seat: 1 })).outcome, 'win');
  assert.equal(derive(base({ status: 'completed', draw: true })).outcome, 'draw');
});

test('if you are seat 2 everything flips correctly', () => {
  const s = base({ current_round: 2 });
  s.seat = 2;
  s.rounds = [{ number: 1, status: 'resolved', winner_seat: 1, prompt_snapshot: { title: 't', description: 'd', weights: W }, submissions: [{ seat: 2, card_id: 'b1', score: 0, explanation: [] }, { seat: 1, card_id: 'a1', score: 5, explanation: [] }] }] as ClashState['rounds'];
  const v = derive(s);
  assert.equal(v.pips[0], 'loss'); assert.deepEqual(v.myUsed, { b1: 1 }); assert.equal(v.myLineup[0].id, 'b1');
});

test('prompt weights sort best-first', () => assert.deepEqual(weightList({ a: 1, b: 5, c: 3 }), [['b', 5], ['c', 3], ['a', 1]]));

test('a tie-break round exposes both powers from your point of view (seat 1 and seat 2)', () => {
  const mk = (seat: number) => {
    const s = base({ current_round: 2 });
    s.seat = seat;
    s.rounds = [{ number: 1, status: 'resolved', winner_seat: 1, prompt_snapshot: { title: 'Clutch', description: 'd', weights: W, tiebreak: 'power', powers: [95, 45] } as never, submissions: [{ seat: 1, card_id: 'a1', score: 8, explanation: [] }, { seat: 2, card_id: 'b1', score: 8, explanation: [] }] }] as ClashState['rounds'];
    return roundResult(s, 1)!;
  };
  assert.deepEqual(mk(1).tiebreak, { mine: 95, theirs: 45 }); assert.equal(mk(1).winner, 'me');
  assert.deepEqual(mk(2).tiebreak, { mine: 45, theirs: 95 }); assert.equal(mk(2).winner, 'opp');
  assert.equal(roundResult(base(), 1)!.tiebreak, null);
});
