// Run with: cd apps/client && npx tsx --test lib/hype.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HypeMeter, scoreMessage } from './hype';

const quiet = ['hey', 'nice game', 'what map is this', 'hi chat', 'ok', 'good aim', 'lol', 'how long has he been live'];
// Feeds `perSec` messages per second for `secs` seconds starting at t0 (ms); returns the time after the last second.
function feed(m: HypeMeter, t0: number, secs: number, perSec: number, msg: (i: number) => [string, number], checkTrigger = false) {
  let fired: number[] = [];
  for (let s = 0; s < secs; s++) {
    for (let k = 0; k < perSec; k++) { const [t, e] = msg(s * perSec + k); m.push(t, e, t0 + s * 1000 + k * (1000 / perSec)); }
    if (checkTrigger && m.snapshot(t0 + (s + 1) * 1000).triggered) fired.push(s);
  }
  return { end: t0 + secs * 1000, fired };
}

test('message scoring: hype and caps beat plain chat; negativity scores below it', () => {
  const plain = scoreMessage('nice game'), hype = scoreMessage('LETS GOOOO POG!!!', 3), neg = scoreMessage('boring trash ff');
  assert.ok(plain > 0 && plain < 1);
  assert.ok(hype > 5, `hype ${hype}`);
  assert.ok(neg < 0, `neg ${neg}`);
  assert.ok(scoreMessage('clip it') > 2.5);
  assert.ok(scoreMessage('POOOOOOG') > scoreMessage('pog') - 0.1); // stretched letters still count
  assert.equal(scoreMessage('   '), 0);
  assert.ok(scoreMessage('x'.repeat(50)) <= 6); // clamped
});

test('a real spike on top of quiet chat triggers once; the cooldown blocks a second trigger', () => {
  const m = new HypeMeter();
  let t = 1_000_000;
  t = feed(m, t, 40, 2, (i) => [quiet[i % quiet.length], 0]).end; // 40 s of calm
  const burst = feed(m, t, 8, 14, (i) => [['LETS GOOO POG!!!', 'CLIP IT CLIP IT', 'OMG WTF INSANE', 'NO WAY HOLY'][i % 4], 2], true);
  assert.equal(burst.fired.length, 1, `fired at ${burst.fired}`);
  assert.ok(burst.fired[0] >= 1 && burst.fired[0] <= 5, `detected within a few seconds of the burst start (second ${burst.fired[0]})`);
  const again = feed(m, burst.end, 20, 14, (i) => ['POG POG POG', 1], true); // still hyped, but inside the 90 s cooldown
  assert.equal(again.fired.length, 0);
});

test('steady busy chat never triggers (the baseline adapts to a loud chat)', () => {
  const m = new HypeMeter();
  const r = feed(m, 5_000_000, 150, 25, (i) => [['POG', 'KEKW', 'nice', 'lol that was close', 'W'][i % 5], 1], true);
  assert.equal(r.fired.length, 0);
});

test('a burst of negative chat is not a hype moment', () => {
  const m = new HypeMeter();
  let t = 9_000_000;
  t = feed(m, t, 40, 2, (i) => [quiet[i % quiet.length], 0]).end;
  const r = feed(m, t, 10, 15, () => ['boring trash lag ff resign cringe', 0], true);
  assert.equal(r.fired.length, 0);
});

test('a few enthusiastic messages in a tiny chat are not enough (minimum volume)', () => {
  const m = new HypeMeter();
  let t = 3_000_000;
  t = feed(m, t, 40, 1, () => ['hi', 0]).end;
  const r = feed(m, t, 8, 1, () => ['LETS GOOO POG OMG INSANE CLIP IT!!!', 4], true); // 1 msg/s of pure hype: < minMsgs in the window
  assert.equal(r.fired.length, 0);
});

test('no trigger during warm-up, and reset() clears state', () => {
  const m = new HypeMeter();
  const r = feed(m, 1_000, 10, 20, () => ['POG LETS GO OMG', 2], true);
  assert.equal(r.fired.length, 0, 'under 20 s of history');
  m.reset();
  const s = m.snapshot(50_000);
  assert.deepEqual(s.series, [0]);
  assert.equal(s.baseline, 0);
});

test('snapshot exposes a graphable series with the peak located', () => {
  const m = new HypeMeter();
  let t = 2_000_000;
  t = feed(m, t, 30, 2, (i) => [quiet[i % quiet.length], 0]).end;
  feed(m, t, 5, 12, () => ['POG!!!', 2]);
  const s = m.snapshot(t + 5000);
  assert.ok(s.series.length >= 35 && s.peak > s.baseline && s.peakIndex >= 30);
  assert.ok(s.threshold >= 9);
});
