"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, n } from "../_components/lib";
import "./scout.css";

type Candidate = {
  videoId: string; videoUrl: string; fetchedAt: string; status: string; note: string; momentId: string | null;
  metadata: null | { title: string; publishedAt: string; thumbnailUrl: string | null; duration: string; views: number | null; likes: number | null; comments: number | null };
};
type Scout = {
  configured: boolean; channel: { name: string; url: string };
  source: { hasMore: boolean; pagesScanned: number; lastScanAt: string | null };
  counts: Record<string, number>; total: number; candidates: Candidate[];
};
const BASE = "/admin/control/scout";
const statuses = { new: "To review", shortlisted: "Shortlisted", promoted: "Sent to KAM", rejected: "Rejected", all: "All" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export default function ScoutPage() {
  const [data, setData] = useState<Scout | null>(null);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("new");
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({ q: "", minViews: "0", year: "" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ status, offset: String(offset), q: filters.q, minViews: filters.minViews || "0" });
    if (filters.year) params.set("year", filters.year);
    api<Scout>(`${BASE}?${params}`).then((result) => {
      if (active) { setData(result); setError(""); }
    }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, offset, filters, version]);
  const candidate = data?.candidates.find((c) => c.videoId === selected) ?? data?.candidates[0];
  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key); setError(""); setNotice("");
    try { setNotice(await fn()); setVersion((v) => v + 1); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  function scan(restart: boolean) {
    void act("scan", async () => {
      const r = await api<{ saved: number; hasMore: boolean; requests: number }>(`${BASE}/scan`, "POST", { restart });
      return `${r.saved} video records retrieved using ${r.requests} YouTube requests. ${r.hasMore ? "Continue discovery to reach older uploads." : "You’ve reached the end of the channel’s uploads."}`;
    });
  }
  const unavailable = Boolean(busy) || loading;
  return (
    <div className="scout">
      <div className="scout-heading">
        <div><h1>Moment Scout</h1><p>Find the next collectible in FaZe’s past.</p></div>
        <Link className="scout-next-link" href="/admin/control/kam">Open KAM Intelligence</Link>
      </div>
      <p className="scout-intro">Discover videos, screen possible cards, then send your picks to KAM. Thumbnails help you browse; final card art is reviewed separately in Moment Studio.</p>
      {error && <div ref={errorRef} tabIndex={-1} className="scout-message scout-error" role="alert">{error} <button className="quiet" onClick={() => setVersion((v) => v + 1)} disabled={unavailable}>Retry loading</button></div>}
      {notice && <p className="scout-message" role="status">{notice}</p>}
      {data && !data.configured && <section className="scout-setup" aria-labelledby="setup-title">
        <h2 id="setup-title">Connect YouTube to start discovering</h2>
        <p>Add <code>YOUTUBE_API_KEY</code> to the API server’s environment and restart the API. Enable YouTube Data API v3 for that key. Keep it on the server.</p>
        <div className="scout-actions"><a href="https://developers.google.com/youtube/v3/getting-started" target="_blank" rel="noreferrer">YouTube setup guide</a><button className="quiet" onClick={() => setVersion((v) => v + 1)} disabled={unavailable}>Check connection</button></div>
        <p className="scout-muted">Discovery is paused. Existing editorial decisions remain available.</p>
      </section>}
      {data && <section className="scout-source" aria-label="Discovery source">
        <div><a href={data.channel.url} target="_blank" rel="noreferrer">{data.channel.name} on YouTube</a>
          <p className="scout-muted">{data.source.pagesScanned ? `${data.source.pagesScanned} upload pages scanned · ${data.source.hasMore ? "More history available" : "End of uploads reached"}` : "Start with recent uploads, then work back through the archive."}</p>
          {data.source.lastScanAt && <small>Last discovery: {new Date(data.source.lastScanAt).toLocaleString()}</small>}
        </div>
        <div className="scout-actions">
          <button disabled={unavailable || !data.configured || !data.source.hasMore} onClick={() => scan(false)}>{busy === "scan" ? "Discovering videos…" : data.source.pagesScanned ? "Discover older videos" : "Discover videos"}</button>
          {data.source.pagesScanned > 0 && <button className="quiet" disabled={unavailable || !data.configured} onClick={() => scan(true)}>Restart from latest</button>}
        </div>
        <p className="scout-source-note">Up to 150 uploads per scan. Sorted by lifetime views among videos discovered so far, not a claim of virality. Videos and Shorts may count views differently.</p>
      </section>}
      <h2 className="scout-section-title">Possible cards</h2>
      <div className="scout-filters" role="group" aria-label="Review status">
        {Object.entries(statuses).map(([value, label]) => <button key={value} className="quiet" aria-pressed={status === value} disabled={!!busy} onClick={() => { setStatus(value); setOffset(0); setSelected(null); }}>{label}{value !== "all" && data ? ` (${data.counts[value] ?? 0})` : ""}</button>)}
      </div>
      <form className="scout-search" onSubmit={(e) => { e.preventDefault(); setFilters(draftFilters); setOffset(0); setSelected(null); }}>
        <label>Video title<input type="search" maxLength={150} placeholder="Search discovered videos" value={draftFilters.q} onChange={(e) => setDraftFilters({ ...draftFilters, q: e.target.value })} /></label>
        <label>Minimum views<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} value={draftFilters.minViews} onChange={(e) => setDraftFilters({ ...draftFilters, minViews: e.target.value })} /></label>
        <label>Upload year<input type="number" min="2005" max={new Date().getUTCFullYear()} placeholder="Any year" value={draftFilters.year} onChange={(e) => setDraftFilters({ ...draftFilters, year: e.target.value })} /></label>
        <button className="quiet" disabled={unavailable}>Apply filters</button>
      </form>
      {loading && <p role="status">Loading possible cards…</p>}
      {!loading && data && !data.candidates.length && <div className="scout-empty"><h3>{data.total ? "No more results on this page" : "No videos in this view yet"}</h3><p>Run discovery to add videos, or change the status and filters. Discovery never creates a card automatically.</p>{offset > 0 && <button onClick={() => setOffset(0)}>Return to first page</button>}</div>}
      {data && data.candidates.length > 0 && <div className="scout-workspace" aria-busy={loading}>
        <div>
          <p className="scout-muted">{offset + 1}–{offset + data.candidates.length} of {data.total} · Most viewed first</p>
          <ul className="scout-list" aria-label="Discovered videos">{data.candidates.map((c) => <li key={c.videoId}>
            <button className="scout-result" aria-pressed={candidate?.videoId === c.videoId} onClick={() => setSelected(c.videoId)} disabled={unavailable}>
              <span className="scout-thumb">{c.metadata?.thumbnailUrl ? <img src={c.metadata.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span>No preview</span>}</span>
              <span className="scout-result-copy"><strong>{c.metadata?.title ?? `Video ${c.videoId}`}</strong><span>{c.metadata ? `${n(c.metadata.views)} views · ${day(c.metadata.publishedAt)}` : "Metadata expired or unavailable"}</span><small>{statuses[c.status as keyof typeof statuses]}</small></span>
            </button>
          </li>)}</ul>
          <div className="scout-pagination"><button className="quiet" disabled={unavailable || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button><button className="quiet" disabled={unavailable || offset + 30 >= data.total} onClick={() => setOffset(offset + 30)}>Next</button></div>
        </div>
        {candidate && <Review key={`${candidate.videoId}:${candidate.status}:${candidate.fetchedAt}`} candidate={candidate} disabled={unavailable} configured={data.configured} act={act} />}
      </div>}
    </div>
  );
}

function Review({ candidate: c, disabled, configured, act }: {
  candidate: Candidate; disabled: boolean; configured: boolean;
  act: (key: string, fn: () => Promise<string>) => Promise<void>;
}) {
  const [note, setNote] = useState(c.note);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [members, setMembers] = useState("");
  const [date, setDate] = useState(c.metadata?.publishedAt.slice(0, 10) ?? "");
  const [timestamp, setTimestamp] = useState("0");
  const m = c.metadata;
  function review(status: string) {
    void act("review", async () => { await api(`${BASE}/${c.videoId}`, "PATCH", { status, note }); return status === "shortlisted" ? "Shortlisted. Add editorial context before sending it to KAM." : "Review decision saved."; });
  }
  function promote(e: FormEvent) {
    e.preventDefault();
    void act("promote", async () => {
      await api(`${BASE}/${c.videoId}/promote`, "POST", { title, summary, members: members.split(",").map((s) => s.trim()).filter(Boolean), occurredOn: date, timestampSeconds: Number(timestamp) });
      return "Added to the archive. Run a KAM scan to evaluate it for a campaign; promotion does not guarantee selection.";
    });
  }
  return <section className="scout-review" aria-label="Video screening">
    <h2>{m?.title ?? "Video metadata unavailable"}</h2>
    {m?.thumbnailUrl && <figure><img src={m.thumbnailUrl} alt={`YouTube thumbnail for ${m.title}`} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} /><figcaption>YouTube thumbnail · Screening preview, not approved card art</figcaption></figure>}
    <a className="scout-watch" href={c.videoUrl} target="_blank" rel="noreferrer">Watch original on YouTube</a>
    {m ? <><dl className="scout-stats"><div><dt>Lifetime views</dt><dd>{n(m.views)}</dd></div><div><dt>Likes</dt><dd>{n(m.likes)}</dd></div><div><dt>Comments</dt><dd>{n(m.comments)}</dd></div></dl><p className="scout-muted">Uploaded {day(m.publishedAt)}. Retrieved {new Date(c.fetchedAt).toLocaleString()}. Missing counts are shown as —. A view count cannot identify the best moment within a video.</p></> : <p>Refresh to check whether this video is still available. Metadata is removed after 30 days; your review decision is retained.</p>}
    <button className="quiet" disabled={disabled || !configured} onClick={() => void act("refresh", async () => { const r = await api<{ available: boolean }>(`${BASE}/${c.videoId}/refresh`, "POST"); return r.available ? "YouTube metadata refreshed." : "YouTube did not return a public video for this candidate."; })}>Refresh metadata</button>
    {c.status === "promoted" ? <div className="scout-promoted"><h3>In the KAM archive</h3><p>Run KAM’s scan to score this moment against collector demand and the existing catalog. Final artwork still needs approval.</p><Link href="/admin/control/kam">Continue to KAM Intelligence</Link></div> : <>
      <label className="scout-field">Screening note<textarea maxLength={1000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this moment is worth considering" /></label>
      <div className="scout-actions"><button disabled={disabled} onClick={() => review("shortlisted")}>{c.status === "shortlisted" ? "Save screening note" : "Shortlist video"}</button><button className="quiet" disabled={disabled} onClick={() => review(c.status === "rejected" ? "new" : "rejected")}>{c.status === "rejected" ? "Return to review" : "Reject"}</button></div>
      {c.status === "shortlisted" && <form className="scout-editor" onSubmit={promote}>
        <h3>Make it a moment</h3><p className="scout-muted">Watch the video and write your own title and context. Confirm the event date; the default is the upload date.</p>
        <label>Moment title<input required minLength={3} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name the moment, not the upload" /></label>
        <label>Why fans remember it<textarea required minLength={20} maxLength={2000} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Describe what happens and why it matters. Keep live view counts out of this text." /></label>
        <label>Featured members<input maxLength={970} value={members} onChange={(e) => setMembers(e.target.value)} placeholder="e.g. Rain, Apex — optional, comma-separated" /></label>
        <div className="scout-form-pair"><label>Event date<input required type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Clip start (seconds)<input required type="number" min="0" max="86400" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} /></label></div>
        <button disabled={disabled || !m}>Send moment to KAM</button>
      </form>}
    </>}
  </section>;
}
