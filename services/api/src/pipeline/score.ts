// Pure scoring + crop geometry. No I/O, no dependencies.
// Landmarks only ever exist in memory here (frontal-ness); nothing returned contains them.

/** A detected face (detector output). `lm` = 5 points: right eye, left eye, nose, right mouth, left mouth. */
export type Face = { x: number; y: number; w: number; h: number; score: number; lm: [number, number][] };
export type Box = { x: number; y: number; w: number; h: number };
export type Scores = { confidence: number; size: number; sharpness: number; frontal: number; exposure: number; total: number };

/** Card art aspect: 5:6 (matches `.card .art { aspect-ratio: 5/6 }`). */
export const ASPECT = 5 / 6;
export const MIN_BOX_H = 24;
export const LOW_RES_BELOW = 400; // crop height in source px

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Image quality of a greyscale face patch (raw 8-bit, `w`×`h`): Laplacian variance, mean luma, clipped fraction. */
export function patchQuality(grey: Uint8Array, w: number, h: number) {
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = grey[i - 1]! + grey[i + 1]! + grey[i - w]! + grey[i + w]! - 4 * grey[i]!;
      sum += l; sum2 += l * l; n++;
    }
  let mean = 0, clip = 0;
  for (const v of grey) { mean += v; if (v < 8 || v > 247) clip++; }
  mean /= grey.length || 1;
  return { lapVar: n ? sum2 / n - (sum / n) ** 2 : 0, mean, clipFrac: clip / (grey.length || 1) };
}

/** Yaw/roll proxies from the 5 landmarks (0 = frontal). Used in memory only. */
export function pose(lm: [number, number][]) {
  const [re, le, no, rm, lmo] = lm as [[number, number], [number, number], [number, number], [number, number], [number, number]];
  const eyeDist = Math.hypot(le[0] - re[0], le[1] - re[1]) || 1;
  const yaw = Math.abs(no[0] - ((re[0] + le[0]) / 2 + (rm[0] + lmo[0]) / 2) / 2) / eyeDist;
  const roll = (Math.abs(Math.atan2(le[1] - re[1], le[0] - re[0])) * 180) / Math.PI;
  return { yaw, roll };
}

/** Weighted total (0..1) + its parts. Tiny faces (<96 px) are penalised: they can't fill a card. */
export function scoreFace(face: Face, q: { lapVar: number; mean: number; clipFrac: number }, frameH: number): Scores {
  const { yaw, roll } = pose(face.lm);
  const size = clamp01(face.h / frameH / 0.45);
  const sharpness = clamp01(Math.log10(1 + Math.max(0, q.lapVar)) / 3);
  const frontal = clamp01(1 - yaw / 0.35) * clamp01(1 - roll / 30);
  const exposure = clamp01(1 - Math.abs(q.mean - 125) / 110) * clamp01(1 - q.clipFrac * 4);
  const confidence = clamp01(face.score);
  const total = (face.h < 96 ? 0.3 : 1) * (0.2 * confidence + 0.25 * size + 0.25 * sharpness + 0.2 * frontal + 0.1 * exposure);
  return { confidence: r3(confidence), size: r3(size), sharpness: r3(sharpness), frontal: r3(frontal), exposure: r3(exposure), total: r3(total) };
}

/**
 * Normalises any box to a 5:6 box inside a W×H frame: keeps its centre, grows the short side to
 * reach 5:6, shrinks to fit the frame, then shifts it inside. Integer pixels.
 */
export function clampBox(b: Box, W: number, H: number): Box {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let h = Math.max(Math.abs(b.h), Math.abs(b.w) / ASPECT, MIN_BOX_H);
  h = Math.min(h, H, W / ASPECT);
  const hh = Math.max(1, Math.floor(h)), ww = Math.max(1, Math.floor(hh * ASPECT));
  const x = Math.round(Math.min(Math.max(cx - ww / 2, 0), W - ww));
  const y = Math.round(Math.min(Math.max(cy - hh / 2, 0), H - hh));
  return { x, y, w: ww, h: hh };
}

/** Head-and-shoulders 5:6 crop: face ≈ 42% of crop height, eye line 40% from the top. */
export function headShoulderBox(face: Face, W: number, H: number): Box {
  const ch = face.h / 0.42, cw = ch * ASPECT;
  const eyeY = face.lm.length >= 2 ? (face.lm[0]![1] + face.lm[1]![1]) / 2 : face.y + face.h * 0.4;
  const top = eyeY - ch * 0.4;
  return clampBox({ x: face.x + face.w / 2 - cw / 2, y: top, w: cw, h: ch }, W, H);
}

/** Output size for a crop: don't upscale much. lowRes when the crop has < 400 source px of height. */
export function outputSize(cropH: number): { width: number; height: number; lowRes: boolean } {
  const height = Math.min(1200, Math.max(600, Math.round(cropH * 1.5)));
  return { width: Math.round(height * ASPECT), height, lowRes: cropH < LOW_RES_BELOW };
}

/** Top `n` candidates by total, at least `minGapMs` apart in time (video) — same frame allowed for stills. */
export function pickTop<T extends { scores: Scores; frameMs: number | null; frameNo: number }>(all: T[], n = 3, minGapMs = 1000): T[] {
  const out: T[] = [];
  for (const c of [...all].sort((a, b) => b.scores.total - a.scores.total)) {
    const ok = out.every((p) => p.frameNo === c.frameNo || p.frameMs === null || c.frameMs === null || Math.abs(p.frameMs - c.frameMs) >= minGapMs);
    if (ok) out.push(c);
    if (out.length === n) break;
  }
  return out;
}
