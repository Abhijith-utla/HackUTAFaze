"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LeaderboardResponse } from "@faze/shared";
import { api } from "@/lib/api";

export default function Leaderboard() {
  const [d, setD] = useState<LeaderboardResponse | null>(null); const [err, setErr] = useState("");
  useEffect(() => { api.leaderboard().then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="err" role="alert">{err}</p>;
  if (!d) return <p className="mute">Loading…</p>;
  return (<>
    <h1>Leaderboard</h1>
    <h2>Top collectors</h2>
    <ol>{d.collectors.map((c) => <li key={c.user.id}>{c.user.displayName} — {c.score} pts</li>)}</ol>
    <h2>Trending cards <span className="badge">simulated hype</span></h2>
    <ol>{d.trending.map((t) => <li key={t.card.id}><Link href={`/cards/${t.card.id}`}>{t.card.name}</Link> — hype {t.hype}</li>)}</ol>
  </>);
}
