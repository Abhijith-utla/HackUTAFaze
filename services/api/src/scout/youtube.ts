import { z } from "zod";
import { fail } from "../errors.js";

// Verified official @FaZeClan channel; no user-supplied upstream URLs or API keys.
export const CHANNEL_ID = "UCNdpD9V0PIrH1glUJ6RG4-w";
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const configured = () => Boolean(process.env.YOUTUBE_API_KEY?.trim());
export const watchUrl = (id: string, seconds = 0) => `https://www.youtube.com/watch?v=${id}${seconds ? `&t=${seconds}s` : ""}`;

const Counter = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger).optional();
const Video = z.object({
  id: z.string().regex(VIDEO_ID),
  snippet: z.object({
    channelId: z.string(), title: z.string().max(1000), publishedAt: z.string().datetime(),
    thumbnails: z.record(z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() })).default({}),
  }),
  statistics: z.object({ viewCount: Counter, likeCount: Counter, commentCount: Counter }).default({}),
  contentDetails: z.object({ duration: z.string().max(80) }),
});
export type VideoMetadata = {
  title: string; publishedAt: string; thumbnailUrl: string | null; duration: string;
  views: number | null; likes: number | null; comments: number | null;
};

export function normalizeVideo(input: unknown): { id: string; metadata: VideoMetadata } | null {
  const parsed = Video.safeParse(input);
  if (!parsed.success || parsed.data.snippet.channelId !== CHANNEL_ID) return null;
  const v = parsed.data;
  const thumbs = Object.values(v.snippet.thumbnails).filter((t) => {
    try { const u = new URL(t.url); return u.protocol === "https:" && u.hostname === "i.ytimg.com" && !u.username && !u.password && !u.port; } catch { return false; }
  }).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return { id: v.id, metadata: {
    title: v.snippet.title, publishedAt: v.snippet.publishedAt, duration: v.contentDetails.duration,
    thumbnailUrl: thumbs[0]?.url ?? null, views: v.statistics.viewCount ?? null,
    likes: v.statistics.likeCount ?? null, comments: v.statistics.commentCount ?? null,
  } };
}

export function youtubeClient() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) fail("CONFLICT", "Configure YOUTUBE_API_KEY on the API server, then restart it.");
  // One deadline covers the entire bounded scan, including response bodies.
  const signal = AbortSignal.timeout(30_000);
  let requests = 0;
  async function get(endpoint: "channels" | "playlistItems" | "videos", params: Record<string, string>) {
    requests++;
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.search = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await fetch(url, { headers: { "X-Goog-Api-Key": key! }, signal, redirect: "error" });
    } catch {
      fail("CONFLICT", "YouTube could not be reached within 30 seconds. Retry the scan.");
    }
    if (!response.ok) {
      // Never forward Google errors, request URLs, or credentials to clients/logs.
      if (response.status === 403 || response.status === 429) fail("CONFLICT", "YouTube refused the request. Check the server key, API access, restrictions and quota, then retry.");
      if (response.status === 400) fail("CONFLICT", "YouTube rejected this request. Check the API key or restart discovery from the latest uploads.");
      fail("CONFLICT", "YouTube is unavailable. Retry later.");
    }
    try { return await response.json() as unknown; } catch { fail("CONFLICT", "YouTube returned an unreadable response. Retry later."); }
  }
  return {
    requests: () => requests,
    async uploads() {
      const data = z.object({ items: z.array(z.object({ id: z.string(), contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }) })) }).safeParse(await get("channels", { part: "contentDetails", id: CHANNEL_ID }));
      const channel = data.success ? data.data.items.find((c) => c.id === CHANNEL_ID) : undefined;
      if (!channel) fail("CONFLICT", "The official channel could not be resolved. Retry later.");
      return channel.contentDetails.relatedPlaylists.uploads;
    },
    async page(playlistId: string, pageToken: string | null) {
      const data = z.object({ nextPageToken: z.string().optional(), items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })).default([]) }).safeParse(await get("playlistItems", {
        part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}),
      }));
      if (!data.success) fail("CONFLICT", "YouTube returned an unexpected playlist response.");
      return { nextPage: data.data.nextPageToken ?? null, ids: [...new Set(data.data.items.map((v) => v.contentDetails.videoId).filter((id) => VIDEO_ID.test(id)))] };
    },
    async videos(ids: string[]) {
      if (!ids.length) return [];
      const data = z.object({ items: z.array(z.unknown()).default([]) }).safeParse(await get("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }));
      if (!data.success) fail("CONFLICT", "YouTube returned an unexpected video response.");
      return data.data.items.map(normalizeVideo).filter((v): v is NonNullable<typeof v> => v !== null && ids.includes(v.id));
    },
  };
}
