// Twitch Helix client (official API only: no HTML scraping, no yt-dlp). App access token via client credentials;
// reads public data (Get Users, Get Streams). Secrets come from the environment and are never logged.
export class TwitchError extends Error {
  constructor(public kind: "not_configured" | "auth" | "rate_limited" | "upstream", message: string, public status?: number) { super(message); }
}

export type TwitchStream = { id: string; title: string; viewerCount: number; startedAt: string; gameName: string };
export type TwitchLiveStream = { userId: string; login: string; name: string; title: string; viewers: number; gameId: string; gameName: string; language: string; startedAt: string };
export type TwitchCategory = { id: string; name: string };
export type TwitchUser = { id: string; login: string; displayName: string; broadcasterType: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type TwitchOptions = { clientId?: string; clientSecret?: string; fetch?: FetchLike; now?: () => number; timeoutMs?: number };

const ID_URL = "https://id.twitch.tv/oauth2/token";
const API = "https://api.twitch.tv/helix";

export class TwitchClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly f: FetchLike;
  private readonly now: () => number;
  constructor(private readonly o: TwitchOptions = {}) {
    this.f = o.fetch ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? Date.now;
  }
  get configured() { return !!(this.o.clientId && this.o.clientSecret); }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.f(url, { ...init, signal: AbortSignal.timeout(this.o.timeoutMs ?? 8000) });
    } catch (e) {
      throw new TwitchError("upstream", `Could not reach Twitch (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"})`);
    }
  }

  private async appToken(force = false): Promise<string> {
    if (!this.configured) throw new TwitchError("not_configured", "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not set");
    if (!force && this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.call(ID_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.o.clientId!, client_secret: this.o.clientSecret!, grant_type: "client_credentials" }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new TwitchError("auth", "Twitch rejected the client credentials", res.status);
    if (!res.ok) throw new TwitchError("upstream", `Twitch token request failed (${res.status})`, res.status);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const token = await this.appToken(attempt > 0);
      const res = await this.call(`${API}${path}?${qs}`, { headers: { "Client-Id": this.o.clientId!, Authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0) continue; // token revoked or expired early: refresh once
      if (res.status === 401) throw new TwitchError("auth", "Twitch rejected the access token", 401);
      if (res.status === 429) throw new TwitchError("rate_limited", "Twitch rate limit reached; try again in a minute", 429);
      if (!res.ok) throw new TwitchError("upstream", `Twitch API error (${res.status})`, res.status);
      return (await res.json()) as T;
    }
  }

  async getUserByLogin(login: string): Promise<TwitchUser | null> {
    const j = await this.get<{ data: any[] }>("/users", { login: login.toLowerCase() });
    const u = j.data[0];
    return u ? { id: u.id, login: u.login, displayName: u.display_name, broadcasterType: u.broadcaster_type } : null;
  }

  /** Categories matching a search (e.g. "Call of Duty"): Twitch's own list, nothing scraped. */
  async searchCategories(query: string, first = 20): Promise<TwitchCategory[]> {
    const j = await this.get<{ data: any[] }>("/search/categories", { query, first: Math.min(Math.max(first, 1), 100) });
    return j.data.map((c) => ({ id: String(c.id), name: String(c.name) }));
  }

  /** Live streams in the given categories, most viewers first (Twitch's default order). Bounded to 100. */
  async getStreamsByGames(gameIds: string[], o: { first?: number; language?: string } = {}): Promise<TwitchLiveStream[]> {
    if (!gameIds.length) return [];
    const qs = new URLSearchParams();
    for (const id of gameIds.slice(0, 100)) qs.append("game_id", id);
    qs.set("first", String(Math.min(Math.max(o.first ?? 20, 1), 100)));
    if (o.language) qs.set("language", o.language);
    const token = await this.appToken();
    const run = async (t: string) => this.call(`${API}/streams?${qs}`, { headers: { "Client-Id": this.o.clientId!, Authorization: `Bearer ${t}` } });
    let res = await run(token);
    if (res.status === 401) res = await run(await this.appToken(true));
    if (res.status === 429) throw new TwitchError("rate_limited", "Twitch rate limit reached; try again in a minute", 429);
    if (res.status === 401 || res.status === 403) throw new TwitchError("auth", "Twitch rejected the access token", res.status);
    if (!res.ok) throw new TwitchError("upstream", `Twitch API error (${res.status})`, res.status);
    const j = (await res.json()) as { data: any[] };
    return j.data.map((x) => ({
      userId: String(x.user_id), login: String(x.user_login), name: String(x.user_name), title: String(x.title ?? ""), viewers: Number(x.viewer_count) || 0,
      gameId: String(x.game_id), gameName: String(x.game_name ?? ""), language: String(x.language ?? ""), startedAt: String(x.started_at ?? ""),
    }));
  }

  async getStream(userId: string): Promise<TwitchStream | null> {
    const j = await this.get<{ data: any[] }>("/streams", { user_id: userId });
    const s = j.data[0];
    return s ? { id: s.id, title: String(s.title ?? ""), viewerCount: Number(s.viewer_count) || 0, startedAt: s.started_at, gameName: String(s.game_name ?? "") } : null;
  }
}
