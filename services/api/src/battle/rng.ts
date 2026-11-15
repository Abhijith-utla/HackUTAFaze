// Seeded PRNG: xoshiro128** with state derived via splitmix32 from a 16-byte (32 hex char) seed.
// Pure 32-bit integer math, so Node and browsers produce identical streams for the same seed.

export const SEED_RE = /^[0-9a-f]{32}$/;

function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

export interface Rng {
  u32(): number;
  /** Uniform-ish integer in [lo, hi] (inclusive), as lo + u32 % (hi - lo + 1). */
  int(lo: number, hi: number): number;
  /** true with probability p. */
  chance(p: number): boolean;
}

export function rngFromSeed(seedHex: string): Rng {
  if (!SEED_RE.test(seedHex)) throw new Error("battle seed must be 32 lowercase hex chars");
  const w = [0, 1, 2, 3].map((i) => parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0);
  let a = splitmix32(w[0] ^ 0x00000000);
  let b = splitmix32(w[1] ^ 0x6a09e667);
  let c = splitmix32(w[2] ^ 0xbb67ae85);
  let d = splitmix32(w[3] ^ 0x3c6ef372);
  if ((a | b | c | d) === 0) a = 1;
  const u32 = () => {
    const t = b << 9;
    let r = Math.imul(b, 5);
    r = Math.imul((r << 7) | (r >>> 25), 9);
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return r >>> 0;
  };
  return {
    u32,
    int: (lo, hi) => lo + (u32() % (hi - lo + 1)),
    chance: (p) => u32() / 2 ** 32 < p,
  };
}
