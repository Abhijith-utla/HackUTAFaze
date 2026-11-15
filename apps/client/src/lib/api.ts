import type { MeResponse, OpenPackResponse, ApiError } from "@faze/shared";
import type { PacksResponse, CollectionResponse } from "./types";
import * as mock from "./mock";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";

export class ApiFailure extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as ApiError | null)?.error;
    throw new ApiFailure(e?.code ?? "UNKNOWN", e?.message ?? res.statusText, res.status);
  }
  return body as T;
}
const post = <T>(p: string, b?: unknown) => http<T>(p, { method: "POST", body: b ? JSON.stringify(b) : undefined });

export const api = {
  signup: (b: { email: string; password: string; displayName: string }) =>
    USE_MOCK ? mock.signup(b) : post<{ user: MeResponse["user"] }>("/auth/signup", b),
  login: (b: { email: string; password: string }) =>
    USE_MOCK ? mock.login(b) : post<{ user: MeResponse["user"] }>("/auth/login", b),
  logout: () => (USE_MOCK ? mock.logout() : post<void>("/auth/logout")),
  me: () => (USE_MOCK ? mock.me() : http<MeResponse>("/me")),
  packs: () => (USE_MOCK ? mock.packs() : http<PacksResponse>("/packs")),
  openPack: (id: string, idempotencyKey: string) =>
    USE_MOCK ? mock.openPack(id) : post<OpenPackResponse>(`/packs/${id}/open`, { idempotencyKey }),
  myCards: () => (USE_MOCK ? mock.myCards() : http<CollectionResponse>("/me/cards")),
};
