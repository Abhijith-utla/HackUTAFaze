"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CardTile } from "@/components/CardTile";
import type { CollectionResponse } from "@/lib/types";

const ORDER = ["legendary", "epic", "rare", "common"];
export default function Collection() {
  const [data, setData] = useState<CollectionResponse["cards"] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.myCards().then((r) => setData(r.cards)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="err" role="alert">{err} <Link href="/login">Log in</Link></p>;
  if (!data) return <p className="mute">Loading…</p>;
  if (!data.length) return <p>No cards yet. <Link href="/store">Open a pack</Link>.</p>;
  const bySet = new Map<string, typeof data>();
  for (const e of data) bySet.set(e.card.setId, [...(bySet.get(e.card.setId) ?? []), e]);
  return (<>
    <h1>My collection</h1>
    {[...bySet].map(([setId, entries]) => (
      <section key={setId}><h2 className="mute">Set {setId.slice(-4)}</h2>
        <div className="grid">
          {[...entries].sort((a, b) => ORDER.indexOf(a.card.rarity) - ORDER.indexOf(b.card.rarity)).map((e) => (
            <Link key={e.card.id} href={`/cards/${e.card.id}`}>
              <CardTile card={e.card} />
              <div className="mute">×{e.count} · serials {e.instances.map((i) => `#${i.serial}${i.locked ? "🔒" : ""}`).join(", ")}</div>
            </Link>))}
        </div></section>))}
  </>);
}
