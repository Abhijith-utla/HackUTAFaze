// Generates the pack-reveal audio with ElevenLabs: a custom UK "hype announcer" voice (Voice Design from a written persona), the
// narration for every special/epic card, the "chat is going mental" call-out, and the party/celebration sound effects.
// The API key is read from the repo-root .env (ELEVEN_LABS_API_KEY) and used only here: it never reaches the browser; the audio is
// pre-generated into apps/client/public/voice. Idempotent: a file is regenerated only when its text/voice/model/settings changed.
//
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs              generate what's missing or changed
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --dry-run    plan + credit estimate, no API calls
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --force      regenerate everything
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --no-design  skip Voice Design, use the best British voice on the account
//   node content/seed/demo-cards/voice/generate-elevenlabs.mjs --auditions   also write 2 alternate voices to /tmp/voice-auditions
// Overrides (.env): ELEVEN_LABS_VOICE_ID (use this exact voice), ELEVEN_LABS_MODEL.
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

const PERSONA_NAME = "FaZe Hype Announcer (UK)";
const PERSONA = "A confident young British man in his mid twenties from London, with a cool, slightly raspy voice. A charismatic esports hype announcer and gaming content host: fast, energetic and playful, with natural conversational rhythm, breathless excitement, genuine laughs and gasps, like a mate commentating a pack opening. Clear diction, a bit of banter, never robotic or stiff.";

const lines = [
  ...demo.special.map((c) => ({ id: c.id, name: c.name, text: c.voiceScript })),
  ...(demo.extraVoices ?? []).map((v) => ({ id: v.id, name: `catalog epic ${v.id.slice(-4)}`, text: v.text })),
  ...Object.entries(demo.announcer ?? {}).map(([id, text]) => ({ id, name: id, text })),
];
const sfx = Object.entries(demo.sfx ?? {}).map(([id, v]) => ({ id, ...v }));
const voiceChars = lines.reduce((n, l) => n + l.text.length, 0);
const sfxSeconds = sfx.reduce((n, s) => n + s.seconds, 0);

if (args.has("--dry-run")) {
  console.log(`${lines.length} voice clips (${voiceChars} characters) + ${sfx.length} sound effects (${sfxSeconds}s). Voice Design adds one custom voice to the account.`);
  process.exit(0);
}
if (!KEY) { console.error("ELEVEN_LABS_API_KEY is not set in .env (save the file, then run again)."); process.exit(2); }

const headers = { "xi-api-key": KEY };
async function call(p, init = {}) {
  const r = await fetch(API + p, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!r.ok) { const body = await r.text().catch(() => ""); throw Object.assign(new Error(`ElevenLabs ${r.status} on ${p.split("?")[0]}: ${body.slice(0, 220)}`), { status: r.status }); }
  return r;
}
const json = (p, init) => call(p, init).then((r) => r.json());
const post = (p, body) => json(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- model ----
const models = await json("/v1/models").catch(() => []);
const ttsModels = new Set(models.filter((m) => m.can_do_text_to_speech).map((m) => m.model_id));
const MODEL = env.ELEVEN_LABS_MODEL || (ttsModels.has("eleven_v3") ? "eleven_v3" : "eleven_multilingual_v2");
const isV3 = MODEL.startsWith("eleven_v3");
console.log(`model: ${MODEL}${isV3 ? " (expressive: audio tags like [laughs] [gasps] [excited])" : ""}`);

// ---- voice: exact override > existing persona voice > Voice Design > best British voice ----
let voices = [];
try { voices = (await json("/v1/voices")).voices ?? []; } catch (e) { console.warn("could not list voices:", e.message); }
const label = (v) => JSON.stringify({ ...v.labels, d: v.description ?? "", n: v.name }).toLowerCase();
const score = (v) => (/british|uk|english \(uk\)/.test(label(v)) ? 5 : 0) + (/"gender":"male"/.test(label(v)) ? 2 : 0)
  + ["energetic", "excited", "hype", "young", "gaming", "casual", "confident", "strong", "social", "characters", "news"].filter((k) => label(v).includes(k)).length;
const ranked = [...voices].sort((a, b) => score(b) - score(a));

async function designPersona() {
  const sample = demo.special.find((c) => c.name.startsWith("Call of Duty"))?.voiceScript.replace(/\[[^\]]+\]\s*/g, "") ?? "Chat is going absolutely mental! A limited card just dropped.";
  const text = sample.length >= 100 ? sample.slice(0, 900) : `${sample} ${sample}`.slice(0, 900);
  let previews;
  try { // current Voice Design endpoint
    previews = (await post("/v1/text-to-voice/design", { model_id: "eleven_ttv_v3", voice_description: PERSONA, text, auto_generate_text: false })).previews;
  } catch (e1) {
    try { previews = (await post("/v1/text-to-voice/create-previews", { voice_description: PERSONA, text })).previews; }
    catch (e2) { throw new Error(`${e1.message} | ${e2.message}`); }
  }
  const id = previews?.[0]?.generated_voice_id;
  if (!id) throw new Error("Voice Design returned no preview");
  const made = await post("/v1/text-to-voice", { voice_name: PERSONA_NAME, voice_description: PERSONA, generated_voice_id: id })
    .catch(() => post("/v1/text-to-voice/create-voice-from-preview", { voice_name: PERSONA_NAME, voice_description: PERSONA, generated_voice_id: id }));
  return { voice_id: made.voice_id, name: PERSONA_NAME };
}

let chosen = null, how = "";
if (env.ELEVEN_LABS_VOICE_ID) { chosen = { voice_id: env.ELEVEN_LABS_VOICE_ID, name: "(ELEVEN_LABS_VOICE_ID)" }; how = "override"; }
if (!chosen) { const existing = voices.find((v) => v.name === PERSONA_NAME); if (existing) { chosen = existing; how = "existing persona voice"; } }
if (!chosen && !args.has("--no-design")) {
  try { chosen = await designPersona(); how = "created with Voice Design from the persona"; }
  catch (e) { console.warn(`Voice Design unavailable (${e.message.slice(0, 200)}); falling back to the best British voice.`); }
}
if (!chosen) { chosen = ranked[0]; how = "best British voice on the account"; }
if (!chosen) { console.error("No voice available. Set ELEVEN_LABS_VOICE_ID in .env."); process.exit(3); }
console.log(`voice: ${chosen.name} (${chosen.voice_id}), ${how}`);

// Delivery. v3 takes audio tags inside the text; other models take style/speed settings and the tags are stripped.
const settings = isV3 ? { stability: 0.5 } : { stability: 0.3, similarity_boost: 0.8, style: 0.65, use_speaker_boost: true, speed: 1.06 };
const prep = (t) => (isV3 ? t : t.replace(/\[[^\]]+\]\s*/g, ""));
const tts = async (voiceId, text) => Buffer.from(await (await call(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: prep(text), model_id: MODEL, voice_settings: settings }),
})).arrayBuffer());
const sound = async (s) => Buffer.from(await (await call("/v1/sound-generation?output_format=mp3_44100_64", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: s.text, duration_seconds: s.seconds, prompt_influence: 0.55 }),
})).arrayBuffer());

mkdirSync(OUT, { recursive: true });
const metaPath = path.join(OUT, "voice.json");
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : { clips: {} };
const hash = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

const used = async () => { try { return (await json("/v1/user/subscription")).character_count; } catch { return undefined; } };
const before = await used();
let made = 0, skipped = 0;
for (const l of lines) {
  const h = hash(l.text, chosen.voice_id, MODEL, settings), file = path.join(OUT, `${l.id}.mp3`);
  if (!args.has("--force") && meta.clips[l.id] === h && existsSync(file)) { skipped++; continue; }
  const audio = await tts(chosen.voice_id, l.text);
  writeFileSync(file, audio); meta.clips[l.id] = h; made++;
  console.log(`  voice  ${l.name.padEnd(30)} ${(audio.length / 1024).toFixed(0)} KB`);
}
for (const s of sfx) {
  const h = hash(s.text, s.seconds), file = path.join(OUT, `${s.id}.mp3`);
  if (!args.has("--force") && meta.clips[s.id] === h && existsSync(file)) { skipped++; continue; }
  try { writeFileSync(file, await sound(s)); meta.clips[s.id] = h; made++; console.log(`  sfx    ${s.id.padEnd(30)} generated`); }
  catch (e) { console.warn(`  sfx ${s.id} failed (${e.message.slice(0, 160)}); the reveal just skips the party sound`); }
}
Object.assign(meta, { engine: "elevenlabs", voiceId: chosen.voice_id, voiceName: chosen.name, model: MODEL, settings, persona: PERSONA, generatedAt: new Date().toISOString() });
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
const after = await used();
console.log(`done: ${made} generated, ${skipped} unchanged${before !== undefined && after !== undefined ? ` (account credit counter ${before} -> ${after})` : ""}`);

if (args.has("--auditions")) {
  mkdirSync("/tmp/voice-auditions", { recursive: true });
  const sample = lines.find((l) => l.id === "hype-alert").text;
  for (const v of ranked.filter((x) => x.voice_id !== chosen.voice_id).slice(0, 2)) {
    const f = `/tmp/voice-auditions/${v.name.replace(/\W+/g, "_")}.mp3`;
    writeFileSync(f, await tts(v.voice_id, sample)); console.log(`  audition: ${f}`);
  }
}
