// Tiny HTTP client with a per-user cookie jar, so each test user is a separate logged-in fan.
import { randomUUID } from "node:crypto";

export interface Res<T = any> {
  status: number;
  body: T;
}

export class Fan {
  cookie = "";
  id = "";
  readonly email = `it-${randomUUID().slice(0, 8)}@demo.faze`;
  readonly password = "integration-pass-1";
  readonly displayName = `it_${randomUUID().slice(0, 6)}`;

  constructor(
    private apiUrl: string,
    private paymentsUrl: string,
  ) {}

  async req<T = any>(base: "api" | "pay", method: string, path: string, body?: unknown): Promise<Res<T>> {
    const res = await fetch(`${base === "api" ? this.apiUrl : this.paymentsUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    const session = set.map((c) => c.split(";")[0]!).find((c) => c.startsWith("session="));
    if (session) this.cookie = session;
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed as T };
  }

  api<T = any>(method: string, path: string, body?: unknown) {
    return this.req<T>("api", method, path, body);
  }
  pay<T = any>(method: string, path: string, body?: unknown) {
    return this.req<T>("pay", method, path, body);
  }

  async signup() {
    const r = await this.api("POST", "/auth/signup", { email: this.email, password: this.password, displayName: this.displayName });
    if (r.status !== 200 && r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
    this.id = r.body.user.id;
    return r;
  }

  async balance(): Promise<number> {
    const r = await this.api("GET", "/me");
    return r.body.balance;
  }
}

/** True if the endpoint exists (anything but 404 "route not found"). Used to skip steps A hasn't shipped yet. */
export async function routeExists(url: string, method = "GET"): Promise<boolean> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  if (r.status !== 404) return true;
  const body = await r.json().catch(() => ({}));
  return !/route .* not found/i.test(JSON.stringify(body));
}
