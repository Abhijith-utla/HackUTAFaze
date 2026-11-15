// Run with: cd apps/client && npx tsx --test app/clash/opponent.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allPlaces, hash, opponentFor } from './opponent';

test('deterministic per match id, different across ids', () => {
  assert.deepEqual(opponentFor('match-1'), opponentFor('match-1'));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => `${opponentFor(`m-${i}`).city}|${opponentFor(`m-${i}`).handle}`));
  assert.ok(seen.size > 60, `variety: ${seen.size}`);
});
test('always a complete, sensible identity', () => {
  for (let i = 0; i < 500; i++) {
    const o = opponentFor(`id-${i}-${i * 7919}`);
    assert.ok(o.handle && o.city && o.country && o.flag);
    assert.ok(o.ping >= 18 && o.ping < 108);
  }
});
test('every place is reachable and the hash is stable', () => {
  const cities = new Set(Array.from({ length: 4000 }, (_, i) => opponentFor(`x${i}`).city));
  assert.equal(cities.size, allPlaces().length);
  assert.equal(hash('abc'), hash('abc'));
});
