import { afterEach, describe, expect, it } from "vitest";
import { TwitchClient, TwitchError } from "../src/twitch/client.js";
import { setTwitchClientForTests } from "../src/routes/twitch.js";

type Call = { url: string; init?: RequestInit };
function fake(handler: (url: string, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, calls.length); };
  return { calls, f };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = () => json({ access_token: "tok", expires_in: 3600, token_type: "bearer" });
const isToken = (u: string) => u.includes("id.twitch.tv");

describe("TwitchClient (user lookup + stream status)", () => {
  it("is not configured without credentials and never calls out", async () => {
    const { f, calls } = fake(() => token());
    const c = new TwitchClient({ fetch: f });
    expect(c.configured).toBe(false);
    await expect(c.getUserByLogin("faze")).rejects.toMatchObject({ kind: "not_configured" });
    expect(calls).toHaveLength(0);
  });
  it("fetches one app token, reuses it until near expiry, then refreshes", async () => {
    let t = 0;
    const { f, calls } = fake((u) => (isToken(u) ? token() : json({ data: [] })));
    const c = new TwitchClient({ clientId: "id", clientSecret: "sec", fetch: f, now: () => t });
    await c.getStream("1"); await c.getStream("1");
    expect(calls.filter((x) => isToken(x.url))).toHaveLength(1);
    t = 3_600_000;
    await c.getStream("1");
    expect(calls.filter((x) => isToken(x.url))).toHaveLength(2);
  });
  it("sends Client-Id + bearer, and the secret only in the token request body", async () => {
    const { f, calls } = fake((u) => (isToken(u) ? token() : json({ data: [{ id: "9", login: "faze", display_name: "FaZe", broadcaster_type: "partner" }] })));
    const c = new TwitchClient({ clientId: "myid", clientSecret: "mysecret", fetch: f });
    expect(await c.getUserByLogin("FaZe")).toEqual({ id: "9", login: "faze", displayName: "FaZe", broadcasterType: "partner" });
    const api = calls.find((x) => x.url.includes("api.twitch.tv"))!;
    expect(api.url).toContain("login=faze");
    expect((api.init!.headers as Record<string, string>)["Client-Id"]).toBe("myid");
    expect((api.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(api.url).not.toContain("mysecret");
  });
  it("refreshes the token once on a 401 and then succeeds", async () => {
    let api = 0;
    const { f, calls } = fake((u) => (isToken(u) ? token() : ++api === 1 ? json({}, 401) : json({ data: [] })));
    const c = new TwitchClient({ clientId: "id", clientSecret: "sec", fetch: f });
    expect(await c.getStream("1")).toBeNull();
    expect(calls.filter((x) => isToken(x.url))).toHaveLength(2);
  });
  it("maps 429, bad credentials and network failures to typed errors", async () => {
    const rl = new TwitchClient({ clientId: "i", clientSecret: "s", fetch: fake((u) => (isToken(u) ? token() : json({}, 429))).f });
    await expect(rl.getStream("1")).rejects.toMatchObject({ kind: "rate_limited" });
    const bad = new TwitchClient({ clientId: "i", clientSecret: "s", fetch: fake(() => json({ message: "invalid client secret" }, 403)).f });
    await expect(bad.getStream("1")).rejects.toMatchObject({ kind: "auth" });
    const net = new TwitchClient({ clientId: "i", clientSecret: "s", fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(net.getStream("1")).rejects.toBeInstanceOf(TwitchError);
  });
  it("maps a live stream", async () => {
    const { f } = fake((u) => (isToken(u) ? token() : json({ data: [{ id: "s1", title: "Scrims", viewer_count: 4200, started_at: "2026-11-15T10:00:00Z", game_name: "Counter-Strike" }] })));
    expect(await new TwitchClient({ clientId: "i", clientSecret: "s", fetch: f }).getStream("1")).toEqual({ id: "s1", title: "Scrims", viewerCount: 4200, startedAt: "2026-11-15T10:00:00Z", gameName: "Counter-Strike" });
  });
});

describe("GET /twitch/live", () => {
  afterEach(() => setTwitchClientForTests(null));
  // The route in isolation (the full buildApp() touches the database while registering other routes).
  async function app() {
    const Fastify = (await import("fastify")).default;
    const { registerErrorHandler } = await import("../src/errors.js");
    const { twitchRoutes } = await import("../src/routes/twitch.js");
    const a = Fastify();
    registerErrorHandler(a);
    await a.register(twitchRoutes);
    return a;
  }
  const mk = (handler: (u: string) => Response) => {
    const { f, calls } = fake((u) => handler(u));
    return { calls, client: new TwitchClient({ clientId: "i", clientSecret: "s", fetch: f }) };
  };
  const helix = (stream: unknown[]) => (u: string) => (isToken(u) ? token() : u.includes("/users") ? json({ data: [{ id: "1", login: "faze", display_name: "FaZe", broadcaster_type: "partner" }] }) : json({ data: stream }));

  it("answers configured:false when there are no credentials", async () => {
    setTwitchClientForTests(new TwitchClient({}));
    const a = await app();
    const r = await a.inject({ url: "/twitch/live" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ configured: false, channel: "faze", live: false });
    await a.close();
  });
  it("reports live with title/viewers, and caches for 60 s (one Twitch lookup for two requests)", async () => {
    const { client, calls } = mk(helix([{ id: "s", title: "Scrims", viewer_count: 99, started_at: "2026-11-15T10:00:00Z", game_name: "CS2" }]));
    setTwitchClientForTests(client);
    const a = await app();
    const one = (await a.inject({ url: "/twitch/live" })).json();
    expect(one).toMatchObject({ configured: true, channel: "faze", live: true, title: "Scrims", viewers: 99, game: "CS2" });
    const n = calls.length;
    expect((await a.inject({ url: "/twitch/live" })).json()).toEqual(one);
    expect(calls.length).toBe(n);
    await a.close();
  });
  it("reports offline", async () => {
    const { client } = mk(helix([]));
    setTwitchClientForTests(client);
    const a = await app();
    expect((await a.inject({ url: "/twitch/live" })).json()).toEqual({ configured: true, channel: "faze", live: false });
    await a.close();
  });
  it("never errors when Twitch is down: live:false with twitch_unavailable", async () => {
    const { client } = mk((u) => (isToken(u) ? token() : json({}, 500)));
    setTwitchClientForTests(client);
    const a = await app();
    const r = await a.inject({ url: "/twitch/live" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ configured: true, live: false, error: "twitch_unavailable" });
    await a.close();
  });
});

describe("Call of Duty live discovery", () => {
  afterEach(() => setTwitchClientForTests(null));
  const stream = (login: string, viewers: number, game_id = "512710") => ({ user_id: login + "-id", user_login: login, user_name: login.toUpperCase(), title: "Ranked grind", viewer_count: viewers, game_id, game_name: "Call of Duty: Warzone", language: "en", started_at: "2026-11-15T10:00:00Z" });
  const helix = (calls: { url: string }[]) => (u: string) => {
    calls.push({ url: u });
    if (isToken(u)) return token();
    if (u.includes("/search/categories")) return json({ data: [{ id: "512710", name: "Call of Duty: Warzone" }, { id: "1", name: "Call of Duty: Black Ops 6" }, { id: "2", name: "Calls of Cthulhu" }] });
    if (u.includes("/streams")) return json({ data: [stream("scump", 5400), stream("hitch", 1200)] });
    return json({ data: [] });
  };
  async function app() {
    const Fastify = (await import("fastify")).default;
    const { registerErrorHandler } = await import("../src/errors.js");
    const { twitchRoutes } = await import("../src/routes/twitch.js");
    const a = Fastify(); registerErrorHandler(a); await a.register(twitchRoutes); return a;
  }

  it("client: searches categories and lists live streams for several game ids", async () => {
    const calls: { url: string }[] = [];
    const c = new TwitchClient({ clientId: "i", clientSecret: "s", fetch: async (u) => helix(calls)(u) });
    expect(await c.searchCategories("Call of Duty")).toEqual([{ id: "512710", name: "Call of Duty: Warzone" }, { id: "1", name: "Call of Duty: Black Ops 6" }, { id: "2", name: "Calls of Cthulhu" }]);
    const live = await c.getStreamsByGames(["512710", "1"], { first: 500, language: "en" });
    const url = calls.find((x) => x.url.includes("/streams"))!.url;
    expect(url).toContain("game_id=512710&game_id=1");
    expect(url).toContain("first=100"); // clamped
    expect(url).toContain("language=en");
    expect(live[0]).toMatchObject({ login: "scump", viewers: 5400, gameName: "Call of Duty: Warzone" });
    expect(await c.getStreamsByGames([])).toEqual([]);
  });

  it("route: only 'Call of Duty*' categories are used, results are cached, and fields are trimmed", async () => {
    const calls: { url: string }[] = [];
    setTwitchClientForTests(new TwitchClient({ clientId: "i", clientSecret: "s", fetch: async (u) => helix(calls)(u) }));
    const a = await app();
    const r = (await a.inject({ url: "/twitch/live-cod" })).json();
    expect(r.configured).toBe(true);
    expect(r.streams.map((s: any) => s.login)).toEqual(["scump", "hitch"]);
    expect(r.streams[0]).toEqual({ login: "scump", name: "SCUMP", title: "Ranked grind", viewers: 5400, game: "Call of Duty: Warzone", language: "en" });
    const streamsCall = calls.find((x) => x.url.includes("/streams"))!.url;
    expect(streamsCall).toContain("game_id=512710&game_id=1");
    expect(streamsCall).not.toContain("game_id=2"); // "Calls of Cthulhu" is not Call of Duty
    const n = calls.length;
    await a.inject({ url: "/twitch/live-cod" });
    expect(calls.length).toBe(n); // 60 s cache
    await a.close();
  });

  it("route: unconfigured -> empty list; Twitch down -> empty list with twitch_unavailable (never a 500)", async () => {
    setTwitchClientForTests(new TwitchClient({}));
    let a = await app();
    expect((await a.inject({ url: "/twitch/live-cod" })).json()).toEqual({ configured: false, streams: [] });
    await a.close();
    setTwitchClientForTests(new TwitchClient({ clientId: "i", clientSecret: "s", fetch: async (u) => (isToken(u) ? token() : json({}, 500)) }));
    a = await app();
    const r = await a.inject({ url: "/twitch/live-cod" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ configured: true, streams: [], error: "twitch_unavailable" });
    await a.close();
  });
});
