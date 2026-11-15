"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Card } from "@faze/shared";
import { api } from "@/lib/api";
import { CardTile } from "@/components/CardTile";

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<{ card: Card; stats: { hype: number } } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.card(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <p className="err" role="alert">{err}</p>;
  if (!d) return <p className="mute">Loading…</p>;
  return (<div style={{ maxWidth: 320 }}>
    <CardTile card={d.card} />
    <div className="card" style={{ marginTop: 12 }}>
      <div>Hype: <strong>{d.stats.hype}</strong> <span className="badge">simulated</span></div>
      <div className="mute">Base power {d.card.basePower}{d.card.maxSupply ? ` · supply ${d.card.maxSupply}` : ""}</div>
    </div></div>);
}
