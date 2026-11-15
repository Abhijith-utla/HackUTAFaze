// Driver: serves brag.html locally (WebCodecs needs a secure context) and drives system Chrome.
// Usage: node render.mjs stills 0.9 3.0 ...   |   node render.mjs video
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = process.env.BRAG_TOOLS;
const { chromium } = await import(path.join(TOOLS, "node_modules/playwright-core/index.mjs"));
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const TYPES = { ".html": "text/html", ".svg": "image/svg+xml", ".mjs": "text/javascript", ".js": "text/javascript" };

const srv = http.createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "brag.html";
  if (name.includes("..")) return res.writeHead(400).end();
  const file = name === "mp4-muxer.mjs" ? path.join(TOOLS, "node_modules/mp4-muxer/build/mp4-muxer.mjs") : path.join(here, name);
  let body;
  try { body = await readFile(file); } catch { console.log("[404]", name); return res.writeHead(404).end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
}).listen(48124, "127.0.0.1");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto("http://localhost:48124/brag.html");
await page.evaluate(() => window.ready);

const [mode, ...args] = process.argv.slice(2);
if (mode === "stills") {
  await mkdir(path.join(here, "stills"), { recursive: true });
  for (const t of args) {
    const url = await page.evaluate((t) => window.still(Number(t)), t);
    const f = path.join(here, "stills", `t${Number(t).toFixed(2)}.jpg`);
    await writeFile(f, Buffer.from(url.split(",")[1], "base64"));
    console.log(f);
  }
} else if (mode === "poster") {
  const url = await page.evaluate(() => window.still(18.6));
  await writeFile(path.join(out, "brag.jpg"), Buffer.from(url.split(",")[1], "base64"));
  console.log(path.join(out, "brag.jpg"));
} else if (mode === "video") {
  const t0 = Date.now();
  const b64 = await page.evaluate(() => window.render());
  await writeFile(path.join(out, "brag.mp4"), Buffer.from(b64, "base64"));
  console.log(path.join(out, "brag.mp4"), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
srv.close();
