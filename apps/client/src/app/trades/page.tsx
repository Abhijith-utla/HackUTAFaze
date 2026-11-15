"use client";
import { useCallback, useEffect, useState } from "react";
import type { Trade, LeaderboardResponse } from "@faze/shared";
import { api } from "@/lib/api";
import type { CollectionResponse, MyTradesResponse } from "@/lib/types";

type Inst = { id: string; label: string };
const flat = (c: CollectionResponse): Inst[] =>
  c.cards.flatMap((e) => e.instances.filter((i) => !i.locked).map((i) => ({ id: i.id, label: `${e.card.name} #${i.serial}` })));

export default function Trades() {
  const [t, setT] = useState<MyTradesResponse | null>(null);
  const [users, setUsers] = useState<LeaderboardResponse["collectors"]>([]);
  const [mine, setMine] = useState<Inst[]>([]); const [theirs, setTheirs] = useState<Inst[]>([]);
  const [to, setTo] = useState(""); const [give, setGive] = useState<string[]>([]); const [get, setGet] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api.myTrades().then(setT).catch((e) => setErr(e.message));
    api.myCards().then((c) => setMine(flat(c))).catch(() => {});
    api.leaderboard().then((l) => setUsers(l.collectors)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => { setGet([]); if (to) api.userCards(to).then((c) => setTheirs(flat(c))).catch((e) => setErr(e.message)); }, [to]);
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    set((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr("");
    const message = String(new FormData(e.currentTarget).get("message") ?? "").trim();
    try { await api.createTrade({ toUserId: to, offeredInstanceIds: give, requestedInstanceIds: get, ...(message && { message }) }); setGive([]); setGet([]); load(); }
    catch (x) { setErr((x as Error).message); }
  }
  async function act(id: string, a: "accept" | "decline" | "cancel") {
    setErr(""); try { await api.tradeAction(id, a); load(); } catch (x) { setErr((x as Error).message); }
  }
  const row = (tr: Trade, incoming: boolean) => (
    <li key={tr.id} className="card" style={{ marginBottom: 8 }}>
      {incoming ? tr.fromUser.displayName : tr.toUser.displayName} · offers {tr.offeredInstanceIds.length}, wants {tr.requestedInstanceIds.length} ·{" "}
      <strong>{tr.status}</strong>
      {tr.message && tr.messageStatus === "approved" && <div className="mute">“{tr.message}”</div>}
      {tr.message && tr.messageStatus === "pending" && !incoming && <div className="mute">Message awaiting review</div>}
      {tr.status === "open" && (incoming
        ? <><button onClick={() => act(tr.id, "accept")}>Accept</button> <button onClick={() => act(tr.id, "decline")}>Decline</button></>
        : <button onClick={() => act(tr.id, "cancel")}>Cancel</button>)}
    </li>);
  const pick = (items: Inst[], sel: string[], set: React.Dispatch<React.SetStateAction<string[]>>) =>
    items.length ? items.map((i) => (
      <label key={i.id} style={{ display: "block" }}><input type="checkbox" style={{ width: "auto", margin: 4 }} checked={sel.includes(i.id)} onChange={() => toggle(set, i.id)} />{i.label}</label>))
      : <p className="mute">None available.</p>;
  return (<>
    <h1>Trades</h1>
    {err && <p className="err" role="alert">{err}</p>}
    <form className="card" onSubmit={send} style={{ marginBottom: 16 }}>
      <h2>New offer</h2>
      <label>Trade with
        <select value={to} onChange={(e) => setTo(e.target.value)} required style={{ width: "100%", padding: 10, margin: "4px 0 12px" }}>
          <option value="">Choose a collector…</option>
          {users.map((u) => <option key={u.user.id} value={u.user.id}>{u.user.displayName}</option>)}
        </select></label>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div><strong>You give</strong>{pick(mine, give, setGive)}</div>
        <div><strong>You get</strong>{to ? pick(theirs, get, setGet) : <p className="mute">Pick a user.</p>}</div>
      </div>
      <label>Message (optional, reviewed before shown)<input name="message" maxLength={140} /></label>
      <button disabled={!to || !give.length || !get.length}>Send offer</button>
    </form>
    <h2>Incoming</h2><ul style={{ padding: 0, listStyle: "none" }}>{t?.incoming.length ? t.incoming.map((x) => row(x, true)) : <p className="mute">None.</p>}</ul>
    <h2>Outgoing</h2><ul style={{ padding: 0, listStyle: "none" }}>{t?.outgoing.length ? t.outgoing.map((x) => row(x, false)) : <p className="mute">None.</p>}</ul>
  </>);
}
