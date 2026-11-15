// Frame/clip analysis: detect faces, score them, build 5:6 head-and-shoulders crops (sharp).
// Output carries scores + crop boxes only — never landmarks.
import { readFile } from "node:fs/promises";
import { detectFaces } from "./detect.js";
import { loadFfmpeg, loadSharp } from "./deps.js";
import { sampleFrames, withTempDir } from "./frames.js";
import { headShoulderBox, outputSize, patchQuality, pickTop, scoreFace, type Box, type Face, type Scores } from "./score.js";

const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export type Candidate = { rank: number; frameNo: number; frameMs: number | null; scores: Scores; box: Box; width: number; height: number; lowRes: boolean; bytes: Buffer };
export type StoredFrame = { frameNo: number; frameMs: number | null; width: number; height: number; mime: "image/jpeg"; bytes: Buffer };
export type Analysis = { frames: StoredFrame[]; candidates: Candidate[]; stats: { frames: number; faces: number; ms: Record<string, number> } };

/** Greyscale 128² face patch → quality signals. */
async function quality(image: Buffer, f: Face, W: number, H: number) {
  const sharp = await loadSharp();
  const left = Math.min(W - 1, Math.max(0, Math.round(f.x))), top = Math.min(H - 1, Math.max(0, Math.round(f.y)));
  const width = Math.max(1, Math.min(W - left, Math.round(f.w))), height = Math.max(1, Math.min(H - top, Math.round(f.h)));
  const data: Buffer = await sharp(image).extract({ left, top, width, height }).resize(128, 128, { fit: "fill" }).greyscale().raw().toBuffer();
  return patchQuality(new Uint8Array(data.buffer, data.byteOffset, data.length), 128, 128);
}

/** Crops `box` (already clamped to the frame) and encodes WebP at `size`, stepping quality down to stay ≤ 2 MB. */
export async function cropWebp(image: Buffer, box: Box, size: { width: number; height: number }): Promise<Buffer> {
  const sharp = await loadSharp();
  for (let q = 82; q >= 42; q -= 10) {
    const buf: Buffer = await sharp(image).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .resize(size.width, size.height, { fit: "fill", kernel: "lanczos3" }).webp({ quality: q, effort: 4 }).toBuffer();
    if (buf.length <= PREVIEW_MAX_BYTES) return buf;
  }
  throw new Error("Crop could not be encoded under 2 MB");
}

type Scored = { frameNo: number; frameMs: number | null; image: Buffer; W: number; H: number; face: Face; scores: Scores };

async function scoreFrame(image: Buffer, frameNo: number, frameMs: number | null, ms: Record<string, number>) {
  let t = performance.now();
  const det = await detectFaces(image);
  ms.detect = (ms.detect ?? 0) + performance.now() - t;
  t = performance.now();
  const out: Scored[] = [];
  for (const face of det.faces) out.push({ frameNo, frameMs, image, W: det.width, H: det.height, face, scores: scoreFace(face, await quality(image, face, det.width, det.height), det.height) });
  ms.quality = (ms.quality ?? 0) + performance.now() - t;
  return { width: det.width, height: det.height, scored: out };
}

async function toCandidates(top: Scored[], ms: Record<string, number>): Promise<Candidate[]> {
  const t = performance.now();
  const out: Candidate[] = [];
  for (const [i, c] of top.entries()) {
    const box = headShoulderBox(c.face, c.W, c.H);
    const size = outputSize(box.h);
    out.push({ rank: i + 1, frameNo: c.frameNo, frameMs: c.frameMs, scores: c.scores, box, width: size.width, height: size.height, lowRes: size.lowRes, bytes: await cropWebp(c.image, box, size) });
  }
  ms.crop = performance.now() - t;
  return out;
}

const round = (ms: Record<string, number>) => Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v)]));

/** One still frame (any PNG/JPEG/WebP). Returns the frame re-encoded as JPEG for private staging. */
export async function analyzeStill(image: Buffer, frameMs: number | null): Promise<Analysis> {
  const sharp = await loadSharp();
  const ms: Record<string, number> = {};
  const t0 = performance.now();
  const jpeg: Buffer = await sharp(image).rotate().flatten({ background: "#000" }).jpeg({ quality: 92 }).toBuffer();
  const { width, height, scored } = await scoreFrame(jpeg, 0, frameMs, ms);
  const candidates = await toCandidates(pickTop(scored, 3), ms);
  ms.total = performance.now() - t0;
  return { frames: [{ frameNo: 0, frameMs, width, height, mime: "image/jpeg", bytes: jpeg }], candidates, stats: { frames: 1, faces: scored.length, ms: round(ms) } };
}

/** An MP4 on disk: sample ~2 fps (capped), detect + score every frame, keep the top 3 ≥ 1 s apart. */
export async function analyzeVideo(videoFile: string, signal?: AbortSignal): Promise<Analysis> {
  const ffmpeg = await loadFfmpeg();
  const ms: Record<string, number> = {};
  const t0 = performance.now();
  return withTempDir(async (dir) => {
    let t = performance.now();
    const frames = await sampleFrames(ffmpeg, videoFile, dir, signal);
    ms.sample = performance.now() - t;
    if (!frames.length) throw new Error("No video frames could be decoded from the upload");
    const all: Scored[] = [];
    for (const [i, fr] of frames.entries()) {
      if (signal?.aborted) throw new Error("Pipeline job timed out");
      all.push(...(await scoreFrame(await readFile(fr.file), i, fr.ms, ms)).scored);
    }
    const top = pickTop(all, 3);
    const candidates = await toCandidates(top, ms);
    const kept = new Map<number, StoredFrame>();
    for (const c of top) if (!kept.has(c.frameNo)) kept.set(c.frameNo, { frameNo: c.frameNo, frameMs: c.frameMs, width: c.W, height: c.H, mime: "image/jpeg", bytes: c.image });
    ms.total = performance.now() - t0;
    return { frames: [...kept.values()], candidates, stats: { frames: frames.length, faces: all.length, ms: round(ms) } };
  });
}
