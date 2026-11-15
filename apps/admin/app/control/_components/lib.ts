// FaZe Control Room — Business Operations (lead, contract v1.6). Shared client helpers.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error?.message ?? `Request failed (${r.status})`), { status: r.status });
  return data as T;
}

/** v1.5: artUrl is relative to the API. */
export const artSrc = (url: string) => (url ? new URL(url, API).toString() : "");

/** Loads data, optionally re-polling; keeps showing the last good data while refreshing. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export const n = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const compact = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString("en-US");
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const s = Math.round((Date.now() - +new Date(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
export const dateLabel = (iso: string, precision: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", ...(precision !== "year" ? { month: "short" } : {}), ...(precision === "day" ? { day: "numeric" } : {}) });
};

export type Signal = { key: string; label: string; weight: number; value: number; points: number; detail: string };
export type Moment = { id: string; occurredOn: string; precision: string; title: string; summary: string; members: string[]; tags: string[]; source: string; citations: string[] };
export type Opportunity = { id: string; status: string; score: number; signals: Signal[]; recommendation: string; moment: Moment };
export type Campaign = {
  id: string; name: string; pitch: string; status: "draft" | "pending_approval" | "approved" | "rejected" | "live" | "ended"; generator: string;
  rightsConfirmed: boolean; rightsNote: string; reviewNote: string; packPriceCoins: number; setId: string | null; packId: string | null;
  submittedAt: string | null; reviewedAt: string | null; launchedAt: string | null; endedAt: string | null; createdAt: string; pulls?: number;
};
export type Asset = { id: string; position: number; name: string; fazeMember: string; rarity: "common" | "rare" | "epic" | "legendary"; lore: string; artUrl: string; basePower: number; maxSupply: number | null; duplicateOf: string | null; duplicateName: string | null; similarity: number | null; cardId: string | null };

export const SIGNAL_COLORS: Record<string, string> = { anniversary: "#ee2441", momentum: "#f59e0b", demand: "#3b82f6", gap: "#a855f7", archive: "#22c55e" };
export const RARITY_COLORS: Record<string, string> = { common: "#8b8b96", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b" };
export const STATUS_LABEL: Record<Campaign["status"], string> = { draft: "Draft", pending_approval: "Awaiting approval", approved: "Approved", rejected: "Changes requested", live: "Live", ended: "Ended" };
