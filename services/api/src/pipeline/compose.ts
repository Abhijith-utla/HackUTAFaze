// Card composer: head-and-shoulders photo + FaZe-style card frame → 1000×1200 (5:6) WebP.
// Text is an SVG overlay rendered by sharp (librsvg + system fonts; no external fonts).
// No FaZe logo or other brand marks are drawn.
import { loadSharp } from "./deps.js";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export const CARD_W = 1000;
export const CARD_H = 1200;
export const RARITY_COLOR: Record<Rarity, string> = { common: "#A4A4AA", rare: "#3D9BFF", epic: "#A35CFF", legendary: "#F5B941" };
const INK = "#111111";
const RED_ALERT = "#E4002B";
const FONT = "Arial, Helvetica, 'Segoe UI', 'DejaVu Sans', 'Liberation Sans', sans-serif";

// Photo window (5:6) inside the frame.
const PAD = 40;
const PHOTO = { x: PAD, y: PAD, w: CARD_W - 2 * PAD, h: Math.round((CARD_W - 2 * PAD) * 1.2) }; // 920×1104

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!)
    // drop control chars librsvg would reject
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Font size so `text` fits `maxW` px (≈0.58 em average glyph width for bold sans). */
const fit = (text: string, maxW: number, max: number, min: number) => Math.max(min, Math.min(max, Math.floor(maxW / (Math.max(1, text.length) * 0.58))));
const trunc = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

export function cardOverlaySvg(input: { name: string; member: string; rarity: Rarity; setLabel?: string }): string {
  const accent = RARITY_COLOR[input.rarity];
  const name = trunc(input.name.trim(), 40), member = trunc(input.member.trim(), 40), set = input.setLabel ? trunc(input.setLabel.trim(), 32) : "";
  const textW = PHOTO.w - 2 * 40;
  const nameSize = fit(name, textW, 68, 34);
  const rarityText = input.rarity.toUpperCase();
  const chipW = 34 + rarityText.length * 19;
  const bottom = PHOTO.y + PHOTO.h;
  const x0 = PHOTO.x + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${INK}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect x="${PHOTO.x}" y="${bottom - 420}" width="${PHOTO.w}" height="420" fill="url(#fade)"/>
  <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="22" fill="none" stroke="${accent}" stroke-width="6"/>
  <rect x="${PHOTO.x}" y="${PHOTO.y}" width="${PHOTO.w}" height="${PHOTO.h}" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="3"/>
  <path d="M${PHOTO.x} ${PHOTO.y + 70} V${PHOTO.y} H${PHOTO.x + 70}" fill="none" stroke="${RED_ALERT}" stroke-width="8"/>
  <path d="M${PHOTO.x + PHOTO.w} ${bottom - 70} V${bottom} H${PHOTO.x + PHOTO.w - 70}" fill="none" stroke="${RED_ALERT}" stroke-width="8"/>
  <rect x="${PHOTO.x + PHOTO.w - chipW - 24}" y="${PHOTO.y + 24}" width="${chipW}" height="48" rx="24" fill="${accent}"/>
  <text x="${PHOTO.x + PHOTO.w - 24 - chipW / 2}" y="${PHOTO.y + 57}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="700" letter-spacing="2" fill="${INK}">${escapeXml(rarityText)}</text>
  ${set ? `<rect x="${PHOTO.x + 24}" y="${PHOTO.y + 24}" width="${Math.min(520, 40 + set.length * 15)}" height="48" rx="8" fill="${INK}" fill-opacity="0.8"/>
  <text x="${PHOTO.x + 44}" y="${PHOTO.y + 56}" font-family="${FONT}" font-size="24" font-weight="700" fill="#FFFFFF">${escapeXml(set)}</text>` : ""}
  <rect x="${x0}" y="${bottom - 210}" width="110" height="10" fill="${RED_ALERT}"/>
  <text x="${x0}" y="${bottom - 120}" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="#FFFFFF">${escapeXml(name)}</text>
  <text x="${x0}" y="${bottom - 62}" font-family="${FONT}" font-size="36" font-weight="600" fill="#D9D9DC">${escapeXml(member)}</text>
  <rect x="${x0 + textW - 160}" y="${bottom - 80}" width="160" height="6" fill="${accent}"/>
</svg>`;
}

/**
 * Composes the card: `photo` (any image, cover-cropped to the 5:6 window) on a #111111 card with a
 * rarity-coloured frame, Red Alert accents and name / member / rarity text. Returns WebP bytes.
 */
export async function composeCard(photo: Buffer, input: { name: string; member: string; rarity: Rarity; setLabel?: string }): Promise<Buffer> {
  const sharp = await loadSharp();
  const photoBuf: Buffer = await sharp(photo).resize(PHOTO.w, PHOTO.h, { fit: "cover", position: "centre" }).toBuffer();
  const overlay = Buffer.from(cardOverlaySvg(input));
  for (let q = 86; q >= 46; q -= 10) {
    const out: Buffer = await sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: INK } })
      .composite([{ input: photoBuf, left: PHOTO.x, top: PHOTO.y }, { input: overlay, left: 0, top: 0 }])
      .webp({ quality: q, effort: 4 })
      .toBuffer();
    if (out.length <= 2 * 1024 * 1024) return out;
  }
  throw new Error("Composed card could not be encoded under 2 MB");
}
