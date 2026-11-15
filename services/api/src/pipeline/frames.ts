// Frame sampling with ffmpeg (ffmpeg-static or FFMPEG_PATH). Local only; nothing is fetched.
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const SAMPLE_FPS = 2;
export const MAX_FRAMES = 180; // 90 s at 2 fps
export const MAX_SECONDS = 90;

export type Frame = { file: string; ms: number };

export function runProcess(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, signal });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split("\n").pop() ?? ""}`))));
  });
}

/** Creates a private temp dir. Callers must `rm` it in `finally` (see withTempDir). */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "faze-faceart-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Samples JPEG frames from `video` into `outDir`: SAMPLE_FPS, at most MAX_SECONDS of input,
 * at most MAX_FRAMES frames, downscaled to ≤1280 px wide. `ms` is the frame's approximate
 * timestamp in the clip (index / fps).
 */
export async function sampleFrames(ffmpegPath: string, video: string, outDir: string, signal?: AbortSignal, fps = SAMPLE_FPS): Promise<Frame[]> {
  await runProcess(
    ffmpegPath,
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-t", String(MAX_SECONDS), "-i", video, "-an", "-sn", "-dn",
      "-vf", `fps=${fps},scale='min(1280,iw)':-2`, "-frames:v", String(MAX_FRAMES), "-q:v", "2", path.join(outDir, "f_%04d.jpg")],
    signal,
  );
  const files = (await readdir(outDir)).filter((f) => /^f_\d{4}\.jpg$/.test(f)).sort();
  return files.map((f, i) => ({ file: path.join(outDir, f), ms: Math.round((i * 1000) / fps) }));
}
