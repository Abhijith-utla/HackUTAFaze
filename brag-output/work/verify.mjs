import http from "node:http"; import { readFile, writeFile } from "node:fs/promises"; import path from "node:path";
const { chromium } = await import(path.join(process.env.BRAG_TOOLS, "node_modules/playwright-core/index.mjs"));
const mp4 = await readFile(path.resolve("../brag.mp4"));
const srv = http.createServer((q, s) => q.url === "/v.mp4" ? s.writeHead(200, { "content-type": "video/mp4" }).end(mp4) : s.writeHead(200, { "content-type": "text/html" }).end("<video id=v muted></video>")).listen(48125);
const b = await chromium.launch({ channel: "chrome", headless: true }); const p = await b.newPage();
await p.goto("http://localhost:48125/");
const info = await p.evaluate(async () => {
  const v = document.getElementById("v"); v.src = URL.createObjectURL(await (await fetch("/v.mp4")).blob()); await new Promise((r) => (v.onloadeddata = r));
  const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight, frames: {} };
  const c = document.createElement("canvas"); c.width = 960; c.height = 540; const g = c.getContext("2d");
  for (const t of [0, 1.2, 4.9, 12.1]) { v.currentTime = t; await new Promise((r) => (v.onseeked = r)); g.drawImage(v, 0, 0, 960, 540); out.frames[t] = c.toDataURL("image/jpeg", 0.8); }
  return out;
});
// audio track present? decode it
const audio = await p.evaluate(async () => { const buf = await (await fetch("/v.mp4")).arrayBuffer(); const ac = new AudioContext(); const a = await ac.decodeAudioData(buf); let peak = 0, sum = 0; const d = a.getChannelData(0); for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; } return { seconds: a.duration, channels: a.numberOfChannels, rate: a.sampleRate, peakDb: 20 * Math.log10(peak), rmsDb: 10 * Math.log10(sum / d.length) }; });
for (const [t, url] of Object.entries(info.frames)) await writeFile(`stills/mp4_t${t}.jpg`, Buffer.from(url.split(",")[1], "base64"));
console.log({ duration: info.duration, size: `${info.w}x${info.h}`, audio });
await b.close(); srv.close();
