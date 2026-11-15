// Chat hype meter. Pure and deterministic (time is passed in), so it is unit-tested without a browser.
// Idea: score every chat message for excitement (hype words, emotes, caps, "!!!"), sum it per second, track a slow baseline of what
// is normal for THIS chat, and flag a spike when the last few seconds are far above that baseline AND there is real volume.

// Hype vocabulary. Weights are per occurrence of the word in a message.
const HYPE: Record<string, number> = {
  pog: 2, poggers: 2.5, pogchamp: 2.5, pogu: 2.5, letsgo: 3, lfg: 3, omg: 2, omfg: 2.5, wtf: 2, holy: 1.5, insane: 2.5, crazy: 1.5, nuts: 2,
  cracked: 2.5, clutch: 3, clutched: 3, clip: 2.5, w: 1.2, ww: 1.8, www: 2.4, gg: 1.2, ggs: 1.2, ez: 1, huge: 1.5, sheesh: 2, goat: 2, wow: 1.5,
  woah: 2, wooo: 2, woo: 1.5, nasty: 2, filthy: 2, dub: 1.5, ace: 2.5, nuke: 3, noscope: 3, trickshot: 3, kekw: 1.2, lul: 0.8, lmao: 1, lmfao: 1.2,
  hype: 1.5, fire: 1.2, based: 1, unreal: 2.5, bro: 0.6, noooo: 1.5, nooo: 1.5, ahhh: 1.5, ahhhh: 1.5, yoooo: 2, yooo: 2, whoa: 1.8,
};
const HYPE_PHRASES: [RegExp, number][] = [[/let'?s go+/g, 3], [/clip (it|that)/g, 3], [/no way/g, 2.2], [/are you kidding/g, 2], [/oh my god/g, 2.2], [/he'?s cracked/g, 2.5]];
const NEG: Record<string, number> = { boring: -1.5, trash: -1.2, bad: -0.8, ff: -1.5, ff15: -1.5, lag: -1, laggy: -1, cringe: -1, mid: -1, resign: -1.5, sadge: -1, pepehands: -1.5, ratio: -0.5, l: -1, nt: -0.2 };

/** Excitement of one chat message: roughly -2 (bored/negative) to 6 (everyone losing it). A plain message is worth ~0.4. */
export function scoreMessage(text: string, emoteCount = 0): number {
  const raw = text.trim();
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  let score = 0.4; // activity itself
  for (const [re, w] of HYPE_PHRASES) score += w * (lower.match(re)?.length ?? 0);
  for (const word of lower.replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)) {
    // repeated letters ("pooooog", "wooooo") collapse so they still match
    const t = word.replace(/'/g, '');
    score += (HYPE[t] ?? HYPE[t.replace(/(.)\1{2,}/g, '$1$1')] ?? HYPE[t.replace(/(.)\1+/g, '$1')] ?? NEG[t] ?? 0);
  }
  score += Math.min(emoteCount, 6) * 0.5;
  const letters = raw.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) score += 1; // SHOUTING
  score += Math.min((raw.match(/!/g) ?? []).length, 4) * 0.3;
  if (/(.)\1{3,}/.test(lower)) score += 0.5; // stretched letters
  return Math.max(-2, Math.min(6, score));
}

export type HypeOptions = {
  windowSec: number;      // seconds of history kept
  baselineAlpha: number;  // EMA weight per second for "normal" chat energy
  multiplier: number;     // spike = recent average >= baseline * multiplier + add
  add: number;
  minHype: number;        // ...and at least this many points per second on average
  minMsgs: number;        // ...with at least this many messages in the recent window
  recentSec: number;      // length of the "recent" window
  hotSeconds: number;     // ...and at least this many of the recent seconds must individually be above the threshold
  cooldownSec: number;    // minimum gap between triggers
  warmupSec: number;      // no triggers until this much history exists
};
export const DEFAULT_HYPE: HypeOptions = { windowSec: 120, baselineAlpha: 0.04, multiplier: 2.2, add: 1.5, minHype: 9, minMsgs: 8, recentSec: 4, hotSeconds: 2, cooldownSec: 90, warmupSec: 20 };

export type HypeSnapshot = {
  series: number[];       // oldest -> newest, one value per second (smoothed over 3 s) for the graph
  raw: number[];
  baseline: number;
  threshold: number;      // the line the recent average has to cross
  recent: number;         // average over the recent window
  msgsRecent: number;
  peakIndex: number;      // index in `series` of the hypest second, -1 if none
  peak: number;
  triggered: boolean;     // true ONLY on the snapshot where a spike was detected (cooldown starts)
};

export class HypeMeter {
  private o: HypeOptions;
  private vals: number[] = [];
  private cnts: number[] = [];
  private curVal = 0;
  private curCnt = 0;
  private curSec: number | null = null;
  private baseline = 0;
  private seconds = 0;
  private lastTrigger = -Infinity;
  constructor(o: Partial<HypeOptions> = {}) { this.o = { ...DEFAULT_HYPE, ...o }; }

  private threshold() { return Math.max(this.o.minHype, this.baseline * this.o.multiplier + this.o.add); }

  /** Closes every completed second up to (not including) the second containing `nowMs`. */
  private roll(nowMs: number) {
    const sec = Math.floor(nowMs / 1000);
    if (this.curSec === null) { this.curSec = sec; return; }
    while (this.curSec < sec) {
      const v = this.curVal;
      if (this.seconds === 0) this.baseline = v; // seed with the first full second, so a chat that is loud from the start is "normal"
      else {
        // After warm-up the baseline barely learns from spikes, so a burst can't raise its own bar. During warm-up it learns at full speed.
        const spike = this.seconds >= this.o.warmupSec && v > this.threshold();
        this.baseline += (spike ? this.o.baselineAlpha * 0.2 : this.o.baselineAlpha) * (v - this.baseline);
      }
      this.vals.push(v); this.cnts.push(this.curCnt);
      if (this.vals.length > this.o.windowSec) { this.vals.shift(); this.cnts.shift(); }
      this.seconds++;
      this.curVal = 0; this.curCnt = 0; this.curSec++;
    }
  }

  push(text: string, emoteCount: number, nowMs: number) {
    this.roll(nowMs);
    this.curVal += scoreMessage(text, emoteCount);
    this.curCnt++;
  }

  /** Call about once a second (and after pushes). Returns what to draw and whether a spike was just detected. */
  snapshot(nowMs: number): HypeSnapshot {
    this.roll(nowMs);
    const raw = [...this.vals, this.curVal];
    const series = raw.map((_, i) => { const a = Math.max(0, i - 2); const w = raw.slice(a, i + 1); return w.reduce((x, y) => x + y, 0) / w.length; });
    const r = this.o.recentSec;
    const recentVals = this.vals.slice(-r), recentCnts = this.cnts.slice(-r);
    const recent = recentVals.length ? recentVals.reduce((x, y) => x + y, 0) / recentVals.length : 0;
    const msgsRecent = recentCnts.reduce((x, y) => x + y, 0);
    const threshold = this.threshold();
    const nowSec = Math.floor(nowMs / 1000);
    const hot = recentVals.filter((v) => v >= threshold).length;
    const triggered = this.seconds >= this.o.warmupSec && recentVals.length >= r && recent >= threshold && hot >= this.o.hotSeconds && msgsRecent >= this.o.minMsgs && nowSec - this.lastTrigger >= this.o.cooldownSec;
    if (triggered) this.lastTrigger = nowSec;
    let peakIndex = -1, peak = 0;
    series.forEach((v, i) => { if (v > peak) { peak = v; peakIndex = i; } });
    return { series, raw, baseline: this.baseline, threshold, recent, msgsRecent, peakIndex, peak, triggered };
  }

  /** Forget everything (e.g. when switching streams). */
  reset() { this.vals = []; this.cnts = []; this.curVal = 0; this.curCnt = 0; this.curSec = null; this.baseline = 0; this.seconds = 0; this.lastTrigger = -Infinity; }
}
