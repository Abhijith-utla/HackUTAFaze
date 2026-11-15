"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { connectContributionPayer, signContributionPayout, type ContributionQuote } from "../../../../lib/contribution-payout";
import { Heading, Toast } from "../_components/ui";
import { ago, api, n, useLoad } from "../_components/lib";

type CardSet = { id: string; name: string; status: string };
type ContributionStatus = "pending" | "approved" | "rejected" | "payout_pending" | "paid";
type Contribution = {
  id: string;
  title: string;
  pitch: string;
  fazeMember: string;
  sourceUrl: string;
  recipientWallet: string;
  contributorName: string;
  bountyLamports: number;
  status: ContributionStatus;
  reviewNote: string;
  createdAt: string;
  paidAt: string | null;
  demo: boolean;
  payout: { reference: string; payerWallet: string; signature: string | null; cluster: "devnet" } | null;
};

const sol = (lamports: number) => (lamports / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-5)}`;
function youtubeThumbnail(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    const videoId = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : host === "youtube.com" || host.endsWith(".youtube.com")
        ? url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]
        : null;
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : null;
  } catch {
    return null;
  }
}

function ContributionCard({ contribution, busy, onApprove, onReject, onPay }: {
  contribution: Contribution;
  busy: boolean;
  onApprove: (contribution: Contribution, bountySol: number) => Promise<void>;
  onReject: (contribution: Contribution) => Promise<void>;
  onPay: (contribution: Contribution) => Promise<void>;
}) {
  const [bountySol, setBountySol] = useState(contribution.bountyLamports ? String(contribution.bountyLamports / 1_000_000_000) : "0.05");
  const pending = contribution.status === "pending";
  const payable = contribution.status === "approved" || contribution.status === "payout_pending";
  const thumbnail = youtubeThumbnail(contribution.sourceUrl);
  return (
    <article className={`contribution-card is-${contribution.status}`}>
      <div className="contribution-head">
        {thumbnail ? (
          <a className="contribution-thumb" href={contribution.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${contribution.title} on YouTube`}>
            <Image src={thumbnail} alt={`${contribution.title} YouTube thumbnail`} width={320} height={180} loading="lazy" />
          </a>
        ) : <div className="contribution-thumb is-empty" aria-label="No YouTube video thumbnail available">NO CLIP PREVIEW</div>}
        <div className="contribution-title">
          <p className="contribution-by">{contribution.contributorName} · {ago(contribution.createdAt)}{contribution.demo ? " · demo" : ""}</p>
          <h2>{contribution.title}</h2>
        </div>
        <span className={`contribution-status ${contribution.status}`}>{contribution.status.replace("_", " ")}</span>
      </div>
      <p className="contribution-pitch">{contribution.pitch}</p>
      <dl className="contribution-meta">
        <div><dt>Member</dt><dd>{contribution.fazeMember}</dd></div>
        <div><dt>Recipient</dt><dd className="contribution-wallet">{contribution.recipientWallet}</dd></div>
        {contribution.sourceUrl && <div className="contribution-source"><dt>Source</dt><dd><a href={contribution.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a><small>{contribution.sourceUrl}</small></dd></div>}
      </dl>
      {contribution.reviewNote && <p className="contribution-note">{contribution.reviewNote}</p>}
      {pending && (
        <div className="contribution-actions">
          <label className="contribution-bounty">Reward · devnet SOL<input aria-label={`Reward for ${contribution.title} in devnet SOL`} value={bountySol} type="number" min="0.001" max="1" step="0.001" onChange={(event) => setBountySol(event.target.value)} disabled={busy} /></label>
          <button disabled={busy} onClick={() => void onApprove(contribution, Number(bountySol))}>{busy ? "Saving…" : "Approve"}</button>
          <button className="quiet" disabled={busy} onClick={() => void onReject(contribution)}>Decline</button>
        </div>
      )}
      {payable && (
        <div className="contribution-actions contribution-pay">
          <div><strong>{sol(contribution.bountyLamports)} devnet SOL</strong><span>{contribution.status === "payout_pending" ? "A quote is pending. Verify it before paying again." : "Approval unlocks one explicit Phantom transfer."}{contribution.demo ? " Test SOL only." : ""}</span></div>
          <button disabled={busy} onClick={() => void onPay(contribution)}>{busy ? "Checking…" : contribution.status === "payout_pending" ? "Finish payout" : "Pay reward"}</button>
        </div>
      )}
      {contribution.status === "paid" && <p className="contribution-paid" role="status">Verified: {sol(contribution.bountyLamports)} devnet SOL sent to {shortWallet(contribution.recipientWallet)}.</p>}
    </article>
  );
}

function AddCard({ sets, busy, onDone }: { sets: CardSet[]; busy: boolean; onDone: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <section className="contribution-create">
      <div><p className="eyebrow">DIRECT ENTRY</p><h2>Add a card.</h2><p className="cr-muted">For an already-cleared moment. Community pitches stay in the queue until they are reviewed.</p></div>
      <form className="contribution-form" onSubmit={onDone}>
        <label>Set<select name="setId" required defaultValue={sets[0]?.id ?? ""} disabled={!sets.length}>{sets.length ? sets.map((set) => <option key={set.id} value={set.id}>{set.name} · {set.status}</option>) : <option>No card sets available</option>}</select></label>
        <label>Card name<input name="name" required maxLength={80} placeholder="The moment, in a few words" /></label>
        <label>FaZe member<input name="fazeMember" required maxLength={60} placeholder="FaZe Temperrr" /></label>
        <label>Rarity<select name="rarity" defaultValue="rare">{["common", "rare", "epic", "legendary"].map((rarity) => <option key={rarity}>{rarity}</option>)}</select></label>
        <label>Art URL<input name="artUrl" required type="url" placeholder="https://…" /></label>
        <label>Power<input name="basePower" type="number" min="0" defaultValue="20" required /></label>
        <label>Max supply <span className="cr-muted">optional</span><input name="maxSupply" type="number" min="1" placeholder="Unlimited" /></label>
        <button disabled={busy || !sets.length}>{busy ? "Adding…" : "Add card"}</button>
      </form>
    </section>
  );
}

export default function ContributionsPage() {
  const contributions = useLoad(() => api<{ contributions: Contribution[] }>("/admin/contributions"), [], 7_500);
  const sets = useLoad(() => api<{ sets: CardSet[] }>("/admin/sets"), []);
  const [mode, setMode] = useState<"queue" | "card">("queue");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try { await work(); }
    catch (error) { setNotice({ msg: (error as Error).message, kind: "err" }); }
    finally { setBusy(""); }
  }

  async function approve(contribution: Contribution, bountySol: number) {
    if (!Number.isFinite(bountySol) || bountySol <= 0) throw Error("Choose a positive devnet SOL reward.");
    await api(`/admin/contributions/${contribution.id}/approve`, "POST", { bountyLamports: Math.round(bountySol * 1_000_000_000) });
    setNotice({ msg: "Approved. The contributor reward now needs your Phantom confirmation." });
    await contributions.reload();
  }

  async function reject(contribution: Contribution) {
    const note = window.prompt("Why is this contribution being declined?", "Needs a clearer source or collector angle.");
    if (note === null) return;
    if (note.trim().length < 3) throw Error("A short review note is required to decline a contribution.");
    await api(`/admin/contributions/${contribution.id}/reject`, "POST", { note: note.trim() });
    setNotice({ msg: "Contribution declined." });
    await contributions.reload();
  }

  async function pay(contribution: Contribution) {
    const payerWallet = await connectContributionPayer();
    const quoted = await api<{ payout: ContributionQuote }>(`/admin/contributions/${contribution.id}/payouts`, "POST", { payerWallet });
    const signature = await signContributionPayout(quoted.payout, (message) => setNotice({ msg: message }));
    setNotice({ msg: "Verifying the finalized devnet transfer…" });
    await api(`/admin/contributions/${contribution.id}/payouts/confirm`, "POST", { signature });
    setNotice({ msg: "Payout verified and recorded." });
    await contributions.reload();
  }

  function addCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void act("add-card", async () => {
      await api("/admin/cards", "POST", { ...data, basePower: Number(data.basePower), maxSupply: data.maxSupply ? Number(data.maxSupply) : null });
      form.reset();
      setNotice({ msg: "Card added to the selected set." });
    });
  }

  const queue = contributions.data?.contributions ?? [];
  const pendingCount = queue.filter((contribution) => contribution.status === "pending").length;
  return (
    <div className="contributions">
      <Heading eyebrow="OPEN CONTRIBUTIONS" title="Good ideas deserve a clean path in.">
        <button className="quiet" onClick={() => void contributions.reload()} disabled={!!busy}>Refresh</button>
      </Heading>
      <p className="contribution-intro">Review community card pitches, then make a single, verifiable devnet reward from your own Phantom wallet. No server wallet. No automatic payout.</p>

      <div className="contribution-tabs" role="tablist" aria-label="Contribution actions">
        <button id="community-queue-tab" role="tab" aria-controls="community-queue" aria-selected={mode === "queue"} className={mode === "queue" ? "on" : ""} onClick={() => setMode("queue")}>Community queue{pendingCount ? <span>{n(pendingCount)}</span> : null}</button>
        <button id="direct-card-tab" role="tab" aria-controls="direct-card" aria-selected={mode === "card"} className={mode === "card" ? "on" : ""} onClick={() => setMode("card")}>Add card</button>
      </div>

      {mode === "card" ? <div id="direct-card" role="tabpanel" aria-labelledby="direct-card-tab"><AddCard sets={sets.data?.sets ?? []} busy={busy === "add-card"} onDone={addCard} /></div> : (
        <section id="community-queue" role="tabpanel" aria-labelledby="community-queue-tab" className="contribution-queue" aria-live="polite">
          {!contributions.loading && !queue.length && <div className="cr-empty"><h2>No contributions yet.</h2><p className="cr-muted">New community pitches will appear here for a fast decision.</p></div>}
          {queue.map((contribution) => <ContributionCard key={contribution.id} contribution={contribution} busy={busy === contribution.id} onApprove={(item, bounty) => act(item.id, () => approve(item, bounty))} onReject={(item) => act(item.id, () => reject(item))} onPay={(item) => act(item.id, () => pay(item))} />)}
          {contributions.error && <p className="cr-error" role="alert">{contributions.error}</p>}
        </section>
      )}
      {notice && <Toast msg={notice.msg} kind={notice.kind} onDone={() => setNotice(null)} />}
    </div>
  );
}
