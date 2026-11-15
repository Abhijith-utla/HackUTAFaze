// Generates the card narrations with ElevenLabs: a UK, gamer-cool, hype-announcer read of each card's voiceScript.
// The API key is read from the repo-root .env (ELEVEN_LABS_API_KEY) and used only here: it never reaches the browser, the audio
// is pre-generated into apps/client/public/voice. Idempotent: a file is only regenerated when its script/voice/model changed.
//
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs            generate what's missing or changed
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --dry-run  show the plan and character count, no API calls
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --force    regenerate everything
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --auditions also write 2 alternate voices to /tmp/voice-auditions
// Overrides (.env): ELEVEN_LABS_VOICE_ID, ELEVEN_LABS_MODEL.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const args = new Set(process.argv.slice(2));
const env = Object.fromEntries(readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
  .map((m) => [m[1], m[2].split(" #")[0].trim().replace(/^["']|["']$/g, "")]));
const KEY = env.ELEVEN_LABS_API_KEY || env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
const API = "https://api.elevenlabs.io";
const OUT = path.join(root, "apps/client/public/voice");
const demo = JSON.parse(readFileSync(path.join(root, "content/seed/demo-cards/demo-cards.json"), "utf8"));
const lines = [...demo.special.map((c) => ({ id: c.id, name: c.name, text: c.voiceScript })), ...Object.entries(demo.announcer ?? {}).map(([id, text]) => ({ id, name: id, text }))];
const totalChars = lines.reduce((n, l) => n + l.text.length, 0);

if (args.has("--dry-run")) { console.log(`${lines.length} clips, ${totalChars} characters of ElevenLabs credit if all are generated.`); process.exit(0); }
if (!KEY) { console.error("ELEVEN_LABS_API_KEY is not set in .env (save the file, then run again)."); process.exit(2); }

const headers = { "xi-api-key": KEY };
async function call(p, init = {}) {
  const r = await fetch(API + p, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!r.ok) { const body = await r.text().catch(() => ""); throw Object.assign(new Error(`ElevenLabs ${r.status} on ${p.split("?")[0]}: ${body.slice(0, 200)}`), { status: r.status }); }
  return r;
}

// ---- pick a model and a voice ----
const models = await call("/v1/models").then((r) => r.json()).catch(() => []);
const ttsModels = new Set(models.filter((m) => m.can_do_text_to_speech).map((m) => m.model_id));
const MODEL = env.ELEVEN_LABS_MODEL || (ttsModels.has("eleven_v3") ? "eleven_v3" : "eleven_multilingual_v2");
const isV3 = MODEL.startsWith("eleven_v3");

let voices = [];
try { voices = (await call("/v1/voices").then((r) => r.json())).voices ?? []; } catch (e) { console.warn("could not list voices:", e.message); }
const label = (v) => JSON.stringify({ ...v.labels, d: v.description ?? "", n: v.name }).toLowerCase();
const score = (v) => (/british|uk|english \(uk\)/.test(label(v)) ? 5 : 0) + (/"gender":"male"/.test(label(v)) ? 2 : 0)
  + ["energetic", "excited", "hype", "young", "gaming", "casual", "confident", "strong", "social", "characters", "news"].filter((k) => label(v).includes(k)).length;
const ranked = [...voices].sort((a, b) => score(b) - score(a));
const chosen = env.ELEVEN_LABS_VOICE_ID ? { voice_id: env.ELEVEN_LABS_VOICE_ID, name: "(from ELEVEN_LABS_VOICE_ID)" } : ranked[0];
if (!chosen) { console.error("No voice available. Set ELEVEN_LABS_VOICE_ID in .env."); process.exit(3); }
console.log(`model: ${MODEL}${isV3 ? " (expressive, audio tags)" : ""}`);
console.log("top voices:", ranked.slice(0, 4).map((v) => `${v.name} [${score(v)}]`).join(", "));
console.log(`using voice: ${chosen.name} (${chosen.voice_id})`);

// Announcer delivery. v3 takes audio tags; v2 models take style/speed settings.
const settings = isV3 ? { stability: 0.5 } : { stability: 0.32, similarity_boost: 0.8, style: 0.62, use_speaker_boost: true, speed: 1.08 };
const prep = (t) => (isV3 ? `[excited] ${t}` : t);

async function tts(voiceId, text) {
  const r = await call(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: prep(text), model_id: MODEL, voice_settings: settings }),
  });
  return Buffer.from(await r.arrayBuffer());
}

mkdirSync(OUT, { recursive: true });
const metaPath = path.join(OUT, "voice.json");
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : { clips: {} };
const hashOf = (text) => createHash("sha256").update(JSON.stringify([text, chosen.voice_id, MODEL, settings])).digest("hex").slice(0, 16);

let before; try { before = (await call("/v1/user/subscription").then((r) => r.json())).character_count; } catch { before = undefined; }
let made = 0, skipped = 0, chars = 0;
for (const l of lines) {
  const h = hashOf(l.text), file = path.join(OUT, `${l.id}.mp3`);
  if (!args.has("--force") && meta.clips[l.id] === h && existsSync(file)) { skipped++; continue; }
  const audio = await tts(chosen.voice_id, l.text);
  writeFileSync(file, audio); meta.clips[l.id] = h; made++; chars += l.text.length;
  console.log(`  wrote ${l.name.padEnd(32)} ${(audio.length / 1024).toFixed(0)} KB`);
}
Object.assign(meta, { engine: "elevenlabs", voiceId: chosen.voice_id, voiceName: chosen.name, model: MODEL, settings, generatedAt: new Date().toISOString() });
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
let after; try { after = (await call("/v1/user/subscription").then((r) => r.json())).character_count; } catch { after = undefined; }
console.log(`done: ${made} generated, ${skipped} unchanged, ~${chars} characters${before !== undefined && after !== undefined ? ` (account counter ${before} -> ${after})` : ""}`);

if (args.has("--auditions")) {
  mkdirSync("/tmp/voice-auditions", { recursive: true });
  const sample = lines.find((l) => l.id === "hype-alert")?.text ?? lines[0].text;
  for (const v of ranked.filter((x) => x.voice_id !== chosen.voice_id).slice(0, 2)) {
    writeFileSync(`/tmp/voice-auditions/${v.name.replace(/\W+/g, "_")}.mp3`, await tts(v.voice_id, sample));
    console.log(`  audition: /tmp/voice-auditions/${v.name.replace(/\W+/g, "_")}.mp3`);
  }
}
