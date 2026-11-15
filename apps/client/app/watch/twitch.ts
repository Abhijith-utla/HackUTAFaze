/** Twitch helpers for /watch: paste-a-link parsing, embed URLs, Embed JS loader. No React here. */

export type TwitchSource =
  | { kind: 'channel'; channel: string }
  | { kind: 'video'; id: string; seconds: number }
  | { kind: 'clip'; slug: string; channel?: string };

const CHANNEL_RE = /^[a-z0-9_]{1,25}$/i;
const SLUG_RE = /^[A-Za-z0-9_-]{3,120}$/;
const VIDEO_RE = /^v?(\d{4,15})$/;
// First path segments on twitch.tv that are pages, not channels.
const RESERVED = new Set(['directory', 'videos', 'settings', 'search', 'downloads', 'jobs', 'p', 'subscriptions', 'inventory', 'wallet', 'friends', 'messages', 'drops', 'turbo', 'prime', 'store', 'login', 'signup', 'embed', 'popout', 'moderator']);

/** "1h2m3s" | "3723" | "3723s" | "62m" -> seconds (0 when absent/invalid). */
export function parseTime(t: string | null | undefined): number {
  if (!t) return 0;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t);
  if (!m || !m[0]) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

/** seconds -> "1h2m3s" (Twitch's `time` / `t` format). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? `${h}h` : ''}${h || m ? `${m}m` : ''}${r}s`;
}

/** Accepts any Twitch channel, VOD or clip link (or a bare channel name). Returns null if it isn't one. */
export function parseTwitchUrl(input: string): TwitchSource | null {
  const raw = input.trim();
  if (!raw) return null;
  if (CHANNEL_RE.test(raw)) return { kind: 'channel', channel: raw.toLowerCase() };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|go)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'clips.twitch.tv') {
    const slug = parts[0] === 'embed' ? u.searchParams.get('clip') : parts[0];
    return slug && SLUG_RE.test(slug) ? { kind: 'clip', slug } : null;
  }
  if (host === 'player.twitch.tv') {
    const video = u.searchParams.get('video'), channel = u.searchParams.get('channel');
    const vm = video ? VIDEO_RE.exec(video) : null;
    if (vm) return { kind: 'video', id: vm[1], seconds: parseTime(u.searchParams.get('time') ?? u.searchParams.get('t')) };
    return channel && CHANNEL_RE.test(channel) ? { kind: 'channel', channel: channel.toLowerCase() } : null;
  }
  if (host !== 'twitch.tv') return null;

  // twitch.tv/videos/<id>?t=1h2m3s
  if (parts[0] === 'videos' && parts[1] && VIDEO_RE.test(parts[1])) return { kind: 'video', id: VIDEO_RE.exec(parts[1])![1], seconds: parseTime(u.searchParams.get('t')) };
  const [first, second, third] = parts;
  if (!first || RESERVED.has(first.toLowerCase()) || !CHANNEL_RE.test(first)) return null;
  // twitch.tv/<ch>/clip/<slug>
  if (second === 'clip' && third && SLUG_RE.test(third)) return { kind: 'clip', slug: third, channel: first.toLowerCase() };
  // legacy twitch.tv/<ch>/v/<id>
  if (second === 'v' && third && VIDEO_RE.test(third)) return { kind: 'video', id: VIDEO_RE.exec(third)![1], seconds: parseTime(u.searchParams.get('t')) };
  return { kind: 'channel', channel: first.toLowerCase() };
}

/** Canonical, shareable twitch.tv URL for a source (what we put in ?src=). */
export function canonicalUrl(s: TwitchSource): string {
  if (s.kind === 'channel') return `https://www.twitch.tv/${s.channel}`;
  if (s.kind === 'video') return `https://www.twitch.tv/videos/${s.id}${s.seconds ? `?t=${formatTime(s.seconds)}` : ''}`;
  return s.channel ? `https://www.twitch.tv/${s.channel}/clip/${s.slug}` : `https://clips.twitch.tv/${s.slug}`;
}

export function sourceLabel(s: TwitchSource): string {
  if (s.kind === 'channel') return `twitch.tv/${s.channel}`;
  if (s.kind === 'video') return `VOD ${s.id}${s.seconds ? ` @ ${formatTime(s.seconds)}` : ''}`;
  return `Clip ${s.slug}${s.channel ? ` (${s.channel})` : ''}`;
}

const parentQs = (parents: string[]) => parents.map(p => `parent=${encodeURIComponent(p)}`).join('&');

/** Plain player iframe (fallback when Embed JS is blocked, and always for clips). */
export function iframeSrc(s: TwitchSource, parents: string[]): string {
  const q = parentQs(parents);
  if (s.kind === 'clip') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(s.slug)}&${q}&muted=true&autoplay=false`;
  if (s.kind === 'video') return `https://player.twitch.tv/?video=${s.id}${s.seconds ? `&time=${formatTime(s.seconds)}` : ''}&${q}&muted=true&autoplay=false`;
  return `https://player.twitch.tv/?channel=${encodeURIComponent(s.channel)}&${q}&muted=true`;
}

export function chatSrc(channel: string, parents: string[]): string {
  return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${parentQs(parents)}&darkpopout`;
}

export const EMBED_JS = 'https://embed.twitch.tv/embed/v1.js';

// Twitch ships no types for Embed JS; kept loose on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TwitchGlobal = any;
declare global { interface Window { Twitch?: TwitchGlobal } }

export function loadEmbedJs(): Promise<void> {
  if (window.Twitch?.Embed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${EMBED_JS}"]`);
    const s = existing ?? Object.assign(document.createElement('script'), { src: EMBED_JS, async: true });
    const timer = setTimeout(() => reject(new Error('Twitch embed script timed out')), 8000);
    s.addEventListener('load', () => { clearTimeout(timer); if (window.Twitch?.Embed) resolve(); else reject(new Error('Twitch embed missing')); }, { once: true });
    s.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Twitch embed script blocked')); }, { once: true });
    if (!existing) document.head.appendChild(s);
    else if (window.Twitch?.Embed) { clearTimeout(timer); resolve(); }
  });
}
