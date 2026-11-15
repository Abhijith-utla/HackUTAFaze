// Is the FaZe Twitch channel live right now? Public, cached 60 s so fan pages can poll without touching Twitch's rate limit.
// Official Helix API only. Without TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET it answers {configured:false, live:false}.
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { fail } from "../errors.js";
import { TwitchClient, TwitchError } from "../twitch/client.js";

let client: TwitchClient | null = null;
const tc = () => (client ??= new TwitchClient({ clientId: config.twitch.clientId, clientSecret: config.twitch.clientSecret }));
let channelId: { login: string; id: string } | null = null;
let liveCache: { at: number; body: object } | null = null;
let codCache: { at: number; body: object } | null = null;
let codCategories: { at: number; ids: string[] } | null = null;

/** Test hook: swap the Twitch client and clear caches. */
export function setTwitchClientForTests(c: TwitchClient | null) {
  client = c;
  channelId = null;
  liveCache = null;
  codCache = null;
  codCategories = null;
}

async function broadcaster(): Promise<string> {
  if (channelId?.login === config.twitch.channel) return channelId.id;
  const u = await tc().getUserByLogin(config.twitch.channel);
  if (!u) fail("NOT_FOUND", `Twitch channel “${config.twitch.channel}” was not found`);
  channelId = { login: config.twitch.channel, id: u.id };
  return u.id;
}

export async function twitchRoutes(app: FastifyInstance) {
  app.get("/twitch/live", async () => {
    const channel = config.twitch.channel;
    if (!tc().configured) return { configured: false, channel, live: false };
    if (liveCache && Date.now() - liveCache.at < 60_000) return liveCache.body;
    let body: object;
    try {
      const s = await tc().getStream(await broadcaster());
      body = s ? { configured: true, channel, live: true, title: s.title, viewers: s.viewerCount, startedAt: s.startedAt, game: s.gameName } : { configured: true, channel, live: false };
    } catch (e) {
      if (e instanceof TwitchError) body = { configured: true, channel, live: false, error: "twitch_unavailable" }; // never break a fan page over Twitch
      else throw e;
    }
    liveCache = { at: Date.now(), body };
    return body;
  });

  // Live Call of Duty streams (any streamer), most viewers first. Official Helix only: category search + Get Streams.
  // Cached 60 s (categories 1 h). Without working credentials it answers {configured, streams: []} and the page falls back.
  app.get("/twitch/live-cod", async () => {
    if (!tc().configured) return { configured: false, streams: [] };
    if (codCache && Date.now() - codCache.at < 60_000) return codCache.body;
    let body: object;
    try {
      if (!codCategories || Date.now() - codCategories.at > 3_600_000) {
        const cats = await tc().searchCategories("Call of Duty", 25);
        codCategories = { at: Date.now(), ids: cats.filter((c) => /^call of duty/i.test(c.name)).map((c) => c.id) };
      }
      const streams = await tc().getStreamsByGames(codCategories.ids, { first: 25 });
      body = {
        configured: true,
        streams: streams.map((s) => ({ login: s.login, name: s.name, title: s.title, viewers: s.viewers, game: s.gameName, language: s.language })),
      };
    } catch (e) {
      if (e instanceof TwitchError) body = { configured: true, streams: [], error: "twitch_unavailable" };
      else throw e;
    }
    codCache = { at: Date.now(), body };
    return body;
  });
}
