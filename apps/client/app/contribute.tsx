"use client";

import { useState, type FormEvent } from "react";
import { request } from "../lib/api";
import { connectContributionWallet } from "../lib/contribution-payout";

type Props = { displayName: string };
type ContributionInput = {
  title: string;
  pitch: string;
  fazeMember: string;
  sourceUrl: string;
  recipientWallet: string;
};

const shortWallet = (value: string) => `${value.slice(0, 6)}…${value.slice(-5)}`;

export default function Contribute({ displayName }: Props) {
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setWallet(await connectContributionWallet());
      setNotice("Phantom wallet connected as the reward destination.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) {
      setError("Connect Phantom first so an approved reward has a destination.");
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const contribution: ContributionInput = {
      title: String(data.get("title") ?? "").trim(),
      pitch: String(data.get("pitch") ?? "").trim(),
      fazeMember: String(data.get("fazeMember") ?? "").trim(),
      sourceUrl: String(data.get("sourceUrl") ?? "").trim(),
      recipientWallet: wallet,
    };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/contributions", contribution);
      form.reset();
      setNotice("Moment sent to the FaZe team. If it’s approved, a devnet reward can be sent to your connected wallet.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="contribute-page" aria-labelledby="contribute-title">
      <div className="contribute-intro">
        <p className="eyebrow">FAZE COMMUNITY / YOUR MOMENT</p>
        <h2 id="contribute-title">Put the moment back in the vault.</h2>
        <p>Pitch a viral clip, a career-defining play, or a nostalgic FaZe memory. The team reviews every idea before it can become a card.</p>
      </div>

      <div className="contribute-layout">
        <form className="contribute-form panel" onSubmit={submit}>
          <p className="contribute-prefill">Sample moment details are prefilled. Edit them to pitch your own moment.</p>
          <label>Moment title<input name="title" required minLength={3} maxLength={100} defaultValue="The 360° FaZe trickshot" /></label>
          <label>FaZe member<input name="fazeMember" required minLength={2} maxLength={80} defaultValue="FaZe Rain" /></label>
          <label>Why this moment matters<textarea name="pitch" required minLength={10} maxLength={2000} rows={5} defaultValue="One clean shot, a wild reaction, and the kind of clip that made fans rewind it again and again. This moment captures the early FaZe trickshot era and the style that built a community." /></label>
          <label>Clip or source link<input name="sourceUrl" type="url" required maxLength={2000} defaultValue="https://www.youtube.com/@FaZeClan" /><small>Link to the original clip, post, or moment.</small></label>

          <div className="contribute-wallet">
            <div><span className="eyebrow">REWARD DESTINATION</span><strong>{wallet ? shortWallet(wallet) : "Phantom not connected"}</strong><small>{wallet ? "This wallet will receive any approved devnet reward." : "Connect the wallet you control."}</small></div>
            <button type="button" className="quiet" onClick={() => void connect()} disabled={busy}>{wallet ? "Reconnect Phantom" : "Connect Phantom"}</button>
          </div>

          {error && <p className="alert error" role="alert">{error}</p>}
          {notice && <p className="alert" role="status">{notice}</p>}
          <p className="contribute-terms">Submitting as {displayName}. Rewards are optional, reviewed by FaZe, and paid in devnet SOL only.</p>
          <button className="primary" disabled={busy || !wallet}>{busy ? "Sending…" : "Submit moment"}</button>
        </form>

        <aside className="contribute-side">
          <p className="eyebrow">HOW IT WORKS</p>
          <ol>
            <li><b>01</b><span>Share the moment and its source.</span></li>
            <li><b>02</b><span>FaZe reviews the pitch and rights.</span></li>
            <li><b>03</b><span>If approved, an admin can send a devnet reward to your connected wallet.</span></li>
          </ol>
          <p className="contribute-devnet">DEVNET SOL HAS NO REAL VALUE</p>
        </aside>
      </div>
    </section>
  );
}
