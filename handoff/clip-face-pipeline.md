# Design B: Clip → best face → card art pipeline (stored in Postgres `card_art`)

Status: proposal plus a working PoC in the scratchpad. No repo files changed.
- Owner of the implementation: Agent A, @toosh-legacy (`services/api/`, migrations).
- Contract additions: lead, @Abhijith-utla (`docs/api.md`, `packages/shared`).
- Admin UI hook: the Control Room studio (`apps/client/app/admin/control/**`), which belongs to the lead.

## 1. Rights and sources (gate before any code runs)
- **Admin only** (`requireAdmin`), and only for **official or approved FaZe sources**. Every job records `source_kind`, `source_ref`, `rights_confirmed` (must be `true` to create a job) and `rights_note`. This mirrors Moment Studio's review gate (`rightsConfirmed` + `rightsNote`). The campaign review step still requires `rightsConfirmed` before launch.
- **Preferred input: an admin-uploaded MP4** that FaZe staff provide or own. No scraping.
- **Twitch clip URL:** use only the official Helix **Get Clips Download** endpoint (open beta 2025). It returns temporary download URLs for clips, *on behalf of the broadcaster or a channel editor* (scopes `editor:manage:clips` / `channel:manage:clips`). That needs a FaZe-authorized token. Without one, reject Twitch URLs. **Do not use yt-dlp or the unofficial `clips.twitch.tv` GQL tricks**: Twitch's ToS forbids downloading content outside provided features.
- **YouTube URL:** YouTube API ToS does not allow downloading video content, and yt-dlp is against YouTube ToS. Accept YouTube only as a *reference* (stored in `source_ref`) next to an uploaded MP4 that FaZe supplied. Never fetch it server-side.
- **Biometrics:** we do face **detection**, not recognition. No identity matching and no embeddings. Landmarks are used in memory for scoring and **not persisted** (only the bbox and scores are stored). This keeps us clear of "biometric identifier" storage (Texas CUBI, Illinois BIPA). The admin picks who the card is about. Note this in the audit entry.
- Every output is labelled `demo` while the hackathon data is demo (`card_art.demo`, following the campaign's `demo` flag).

## 2. Pipeline steps
```
upload mp4 (≤100 MB, ≤90 s)  ─┐
Helix clip download URL ──────┴─► temp file (os.tmpdir, deleted in finally)
  └─ ffprobe sanity (duration, has video)            ffmpeg-static
  └─ sample: fps=2, scale ≤1280w, ≤180 frames → JPEG  ffmpeg-static
  └─ per frame: letterbox 640² BGR → YuNet (ONNX)      onnxruntime-node + sharp
       decode 3 strides, NMS 0.3, keep conf ≥ 0.6
  └─ per face: quality signals on the original-res crop          sharp (raw greyscale)
  └─ rank, dedupe (≥1 s apart; IoU-tracked same face → best only), top 3
  └─ crop 5:6 around eyes, mirror-pad if out of frame, WebP q82  sharp
  └─ store candidates (private) in pipeline_candidates.bytes
admin picks n → storeArt(card_art) → /art/<id>.webp → campaign_assets.art_url (or card)
```

### Scoring (used in the PoC, weights tunable)
| Signal | How | Weight |
|---|---|---|
| Detector confidence | YuNet `sqrt(cls*obj)` | 0.20 |
| Face size | `face.h / frame.h / 0.45`, clamped to 1; ×0.3 penalty if face < 96 px | 0.25 |
| Sharpness | Laplacian variance on the face resized to 128² grey; `log10(1+var)/3` | 0.25 |
| Frontal-ness | YuNet 5 landmarks: yaw ≈ `|nose.x − mid(eyes,mouth).x| / eyeDist` (0 = frontal), roll from the eye line; `(1−yaw/0.35)·(1−roll/30°)` | 0.20 |
| Exposure | Mean luma near 125 and clipped-pixel fraction | 0.10 |
| Eyes open | **Not available** from 5-point landmarks. Option: add a 68-point landmark ONNX (PFLD, ~1–3 MB) and compute eye aspect ratio. Defer; the admin picks from the top 3 anyway. | n/a |

Crop: 5:6 (matches `main .card .art { aspect-ratio: 5/6 }` in `polish.css` and `.art` in `style.css`). The face takes about 42% of the crop height with the eye line at 40% from the top, and the crop is capped at 1.15× the frame height. Where it leaves the frame, pad with `extend({extendWith:'mirror'})`. **Output size:** do not upscale much. Use `out_h = min(1200, max(600, round(crop_h * 1.5)))` and `out_w = out_h * 5/6`. If `crop_h < 400` source px, flag the candidate as `lowRes` so the admin sees it. WebP q82 gives roughly 40–250 KB, comfortably under the 2 MiB limit in `storeArt`. Loop q down by 10 if it is ever over.

## 3. Library choice

| Option | Works in Node on Win and Linux? | Footprint | Verdict |
|---|---|---|---|
| **onnxruntime-node 1.31.1 + YuNet 2023mar (OpenCV Zoo, MIT, 227 KB)** | Yes, prebuilt N-API for win/linux/mac x64 and arm64. **Tested on this Windows box.** | npm install **294 MB** (bundles every platform; per platform: linux-x64 46 MB, win-x64 66 MB incl. DirectML). ~4 ms/frame. | **Chosen.** Smallest model with landmarks and a simple decode. |
| onnxruntime-web 1.31.1 (wasm) + YuNet | Yes, pure wasm, no native binary. **Tested:** 28 ms/frame single-thread. | 145 MB install (4 wasm variants; the one loaded is 15 MB) | **Fallback** if the native binary is a problem (e.g. an Alpine/musl container). Same decode code, just `import * as ort from 'onnxruntime-web'`. |
| @vladmandic/human | tfjs-node (native, flaky Windows builds) or tfjs-wasm | Multiple-MB models; tfjs-node ~150 MB+ | Overkill (body, gesture, emotion). Heavier. |
| @mediapipe/tasks-vision | Built for the browser (WebGL/wasm with DOM). No supported Node path without canvas polyfills | ~10 MB+ | Not for server-side Node. |
| face-api.js / @vladmandic/face-api | tfjs; tiny detector 190 KB + 68-pt landmarks 350 KB (gives eye-open) | tfjs-node heavy, or slow wasm | Viable but heavier and slower. Revisit only if we want eyes-open. |
| opencv4nodejs | Native OpenCV build | Huge, painful on Windows | No. |

Supporting libraries:
- **sharp 0.35.5**: prebuilt libvips, ~20 MB per platform (`@img/sharp-<platform>`). Does decode, crop, extend, greyscale raw and WebP encode.
- **ffmpeg-static 5.3.0**: the win-x64 binary is ffmpeg 6.1.1 "essentials", **80 MB**. **ffmpeg is not on PATH on this machine** (`ffmpeg -version` fails), so we use ffmpeg-static, or `FFMPEG_PATH` if set. Licence is GPL for the bundled build. The binary downloads from GitHub at `npm install`, so CI needs network or a cache.

**Footprint mitigation:** put `onnxruntime-node`, `ffmpeg-static` and `sharp` under `optionalDependencies` of `@faze/api` and **lazy-import** them inside the pipeline module, so the API still boots and tests still run if they are missing. The route returns `503 PIPELINE_UNAVAILABLE` in that case, or gate it with `FACE_ART_PIPELINE=on`. For the model, commit `services/api/models/face_detection_yunet_2023mar.onnx` (227 KB, MIT; add the licence file) and verify `sha256 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` at load.

## 4. API shape (contract change: the lead must add this to `docs/api.md`, proposed v1.8)
All routes are `requireAdmin` and live in a new `services/api/src/routes/pipeline.ts` plus `src/pipeline/face-art.ts`.

| Method | Path | Body → Response |
|---|---|---|
| POST | `/admin/pipeline/face-art` | **JSON** `{source: {kind: "upload", base64, mimeType: "video/mp4"} \| {kind: "twitch_clip", clipId}, rightsConfirmed: true, rightsNote, sourceRef?, campaignId?, assetId?}` → `202 {jobId}`. See note below. |
| GET | `/admin/pipeline/jobs/:id` | → `{job: {id, status: queued\|running\|done\|failed, error?, stats: {frames, faces, ms}}, candidates: [{n, score, parts, timeSec, faceBox, lowRes, previewUrl}]}` |
| GET | `/admin/pipeline/jobs/:id/candidates/:n.webp` | admin-only preview bytes (`nosniff`, `Cache-Control: private`). Candidates are **not** in `card_art`, so they are never public before the pick. |
| POST | `/admin/pipeline/jobs/:id/pick` | `{n, target: {campaignId, assetId} \| {cardId}}` → `{artUrl}`. Calls `storeArt()` (dedupes by sha256), then: campaign asset → `UPDATE campaign_assets SET art_url` (only while the campaign is `draft`/`rejected`, the same rule as `PATCH …/assets/:assetId`); card → the same path as `PATCH /admin/cards/:id`. Writes an `audit_log` row `{action: "face_art.pick", jobId, source_ref, rights_note}`. |

Upload transport: the API has no `@fastify/multipart` today. Two options:
- **Multipart (recommended):** add `@fastify/multipart` with `limits.fileSize = 100 MB`, scoped to this route only. Stream the upload to a temp file and never buffer it in memory.
- **Base64 JSON:** no new dependency, but the body limit has to be ~135 MB and it buffers in memory. Acceptable only for clips of 15 MB or less.

Errors: `VALIDATION` (rights not confirmed, not MP4, too long or too big), `NOT_FOUND`, `CONFLICT` (campaign not editable). A new code `PIPELINE_UNAVAILABLE 503` would need the lead to add it.

**Execution:** start with an **in-process runner** in the API. One job at a time, claimed with `UPDATE … WHERE id = (SELECT id FROM pipeline_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, polled every 2 s plus a kick on create. Because the claim is SQL, it can later move to `services/worker` (D, @tanejakeshav) without schema changes. I did not reuse the existing `jobs` table: its `kind` CHECK only allows `engagement_spike|publish_set|moderate`, the worker polls it, and changing that CHECK touches D's consumer.

Temp video: written to `os.tmpdir()/faceart-<jobId>/` and deleted in `finally`. Only the sha256 and byte length of the source are persisted, never the video (it is too big for the DB and has unclear rights retention).

## 5. Migration `services/api/migrations/005_face_art_pipeline.sql`
005 is the next free number (001–004 exist on `main`, and no branch reserves 005). Coordinate with the Moment Scout v1.7 work in case it needs a migration too: whoever lands first takes 005.
```sql
-- v1.8 (proposed): clip → face → card art pipeline. Admin-only; candidates stay private until picked.
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'face_art' CHECK (kind IN ('face_art')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  source_kind text NOT NULL CHECK (source_kind IN ('upload','twitch_clip')),
  source_ref text NOT NULL DEFAULT '',             -- clip id / official URL / filename (reference only)
  source_sha256 text,
  source_bytes integer CHECK (source_bytes IS NULL OR source_bytes > 0),
  rights_confirmed boolean NOT NULL CHECK (rights_confirmed),   -- cannot create a job without it
  rights_note text NOT NULL DEFAULT '',
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES campaign_assets(id) ON DELETE SET NULL,
  stats jsonb NOT NULL DEFAULT '{}',               -- {frames, faces, ms:{ffmpeg,infer,...}}
  error text,
  picked_art_id uuid REFERENCES card_art(id),
  demo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_jobs_queued_idx ON pipeline_jobs(created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS pipeline_candidates (
  job_id uuid NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  n smallint NOT NULL CHECK (n BETWEEN 1 AND 3),
  score numeric(5,4) NOT NULL,
  parts jsonb NOT NULL,                            -- {confidence,size,sharpness,frontal,exposure}; no landmarks
  time_sec numeric(8,2) NOT NULL,
  face_box integer[] NOT NULL,                     -- [x,y,w,h] in source pixels
  low_res boolean NOT NULL DEFAULT false,
  mime text NOT NULL DEFAULT 'image/webp' CHECK (mime = 'image/webp'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  PRIMARY KEY (job_id, n)
);
```
**Tiger Cloud and other managed Postgres:** this uses nothing beyond what 001–004 already need (`gen_random_uuid()` is core in PG13+, plus `bytea` and `jsonb`), and works through `DATABASE_URL` with `sslmode=require`. Storage is roughly 3 × 50–250 KB per job. Optionally purge candidates of picked or failed jobs older than 7 days. Adopting Tiger Cloud is still **pending the lead's decision** (AGENTS.md "Stack"), and nothing here depends on it.

## 6. Admin UI (lead-owned Control Room)
In the campaign asset editor, add a "Make art from clip" button. It opens a modal with the file input (MP4), a rights checkbox and note (required), and a source reference, then calls `POST /admin/pipeline/face-art`. It polls `GET …/jobs/:id` every 1.5 s, shows 3 candidate tiles at 5:6 with score bars (sharpness, frontal, size) and a `lowRes` badge, and "Use this" calls `/pick`, which refreshes the asset. Keep it in `apps/client/app/admin/control/studio/face-art.tsx` (needs a handoff from the lead).

## 7. PoC (scratchpad only)
Files:
- Script: `C:\Users\tusha\AppData\Local\Temp\claude\7c9611d526c382c4\f1ac91ce-ad7b-4f69-88b6-7ebd5fd6de89\scratchpad\pipeline-poc\face-art.mjs`
- Benchmarks: `...\scratchpad\pipeline-poc\bench-node.mjs`, `...\scratchpad\pipeline-poc-web\bench.mjs`
- Assets: `...\scratchpad\pipeline-poc-assets\` (YuNet model, two public-domain NASA portraits from Wikimedia Commons, and a generated `sample.mp4`)
- Outputs: `...\scratchpad\pipeline-poc\out\candidate_{1,2,3}.webp`, `preview1.png`

Run:
```
cd <scratchpad>\pipeline-poc
npm i onnxruntime-node sharp ffmpeg-static
node face-art.mjs ..\pipeline-poc-assets\sample.mp4 ..\pipeline-poc-assets\yunet_2023mar.onnx out 2
```
Test clip (8 s, 1280×720, generated with ffmpeg-static):
- 0–2 s: small face (51 px)
- 2–5 s: zooming portrait (118–146 px)
- 5–7 s: the same portrait with a heavy Gaussian blur
- 7–8 s: `testsrc2`, no face

Results on Windows 11, Node 22.19, CPU only:
- All 14 face frames were detected (conf 0.88–0.93), and the two no-face frames correctly had 0 detections.
- The top 3 all came from the sharp, zoomed segment (score 0.71–0.73). The blurred frames and the small-face frames ranked below, as intended.
- Crops were 5:6 WebP at 1000×1200, 44–48 KB. A visual check showed a well-framed head and shoulders portrait.
- Timings: model load 65 ms, ffmpeg sampling 114 ms, preprocess 343 ms, **inference 82 ms total for 16 frames (~4–5 ms/frame)**, quality 236 ms, crop+encode 235 ms; **total 1.09 s**.
- Estimate for a 60 s clip at 2 fps (120 frames): about 5–8 s end to end. With onnxruntime-web wasm, inference is ~28 ms/frame, so about +3 s.

Gaps found:
- Faces around 140 px got upscaled to 1200 px. Hence the output-size rule and `lowRes` flag in §2.
- Real FaZe footage will often show several faces, plus overlays and webcams (facecam boxes). Next steps: prefer the largest and most central face, track faces across frames by IoU so the top 3 are not the same face 1 s apart, and optionally let the admin draw or choose a face.
- Not tested yet: a real 1080p60 clip, Linux CI. onnxruntime-node ships linux-x64 glibc binaries; it will not work on Alpine/musl, so use onnxruntime-web there.

## 8. Risks
- **Rights and ToS:** the highest risk. The design only allows uploads FaZe supplied or authorized Helix clip downloads, and requires the rights flag.
- **Install weight:** about 400 MB of node_modules (onnxruntime-node 294 MB + ffmpeg-static 80 MB + sharp ~20 MB) in `services/api`. Mitigate with optionalDependencies and lazy import, or move the pipeline into `services/worker`.
- **ffmpeg-static GPL binary:** fine to run, but be careful when redistributing it in a container image.
- **CPU spikes in the API process:** a single-concurrency runner caps it, plus the frame limit (≤180) and duration limit (≤90 s). Move to the worker if the API is shared.
- **Detection quality:** YuNet is strong for frontal and near-profile faces, weaker for tiny faces in gameplay facecams. The admin always picks, so there is no auto-publish.
- **Biometric law:** detection only, no landmarks persisted, no identity matching.
- **Contract freeze:** new endpoints and a new error code need the lead to add v1.8 to `docs/api.md` and `packages/shared`.

## 9. Open questions
1. Lead: approve v1.8 (endpoints above, `PIPELINE_UNAVAILABLE` 503 or reuse `VALIDATION`)? Multipart or base64?
2. Is there a FaZe-authorized Twitch token for Get Clips Download, or is it upload-only for the demo?
3. Which clips are approved? Is there a list of official sources FaZe staff will provide, and who is the rights contact for `rights_note`?
4. Run in the API process (Tush) or in `services/worker` (Keshav)?
5. Tiger Cloud adoption status. The design is DB-host neutral, but the bytea growth of candidates should be budgeted on the managed plan.
6. Do we want eyes-open scoring (adds a ~1–3 MB landmark model) or rely on the admin's pick?
