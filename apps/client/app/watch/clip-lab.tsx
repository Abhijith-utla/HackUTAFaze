'use client';
import type { Rarity } from '@faze/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, art, request } from '../../lib/api';
import { canCaptureTab, captureElement, frameFromFile, type Frame } from './capture';
import CropEditor, { CropPreview, cardBoxAround, defaultBox, roundBox, type Box, type Candidate } from './crop-editor';

/*
 * Clip Lab (staff): capture one frame of the player, crop it to a 5:6 card, optionally detect faces, and send
 * it to card generation. Uses the staff pipeline endpoints (admin session cookie):
 *   POST /admin/pipeline/face-frame       -> { jobId, candidates }
 *   POST /admin/pipeline/jobs/:jobId/pick -> { artUrl, draft }
 * The draft then continues through the Control Room's rights/approval gate. Nothing here publishes a card.
 */

export type Stamp = { timestampMs?: number; timestampIso?: string; label: string };
type Captured = Frame & { sourceUrl: string; sourceLabel: string; stamp: Stamp; how: string };
type FaceFrameResponse = { jobId: string; candidates: Candidate[] };
type PickResponse = { artUrl: string; draft?: Record<string, unknown> | null };
type Status = { kind: 'idle' | 'busy' | 'ok' | 'error' | 'auth' | 'missing'; text?: string };
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

function describe(e: unknown, what: string): Status {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return { kind: 'auth', text: 'Sign in as staff at /admin to analyse frames.' };
    if (e.status === 404 && what === 'detect') return { kind: 'missing', text: 'The frame pipeline isn’t deployed on this API yet (POST /admin/pipeline/face-frame returned 404).' };
    if (e.status === 404) return { kind: 'error', text: 'That analysis job no longer exists on the API. Detect faces again to start a new one.' };
    if (e.status === 413) return { kind: 'error', text: 'The frame is too large for the API. Crop the browser window smaller and re-capture.' };
    return { kind: 'error', text: e.message };
  }
  if (e instanceof TypeError) return { kind: 'error', text: 'Can’t reach the API. Check that it is running and allows this origin.' };
  return { kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' };
}

export default function ClipLab({ playerEl, getStamp, sourceUrl, sourceLabel, members, canEmbed }: {
  playerEl: () => HTMLElement | null; getStamp: () => Stamp;
  sourceUrl: string; sourceLabel: string; members: string[]; canEmbed: boolean;
}) {
  const [captureOk, setCaptureOk] = useState(false);
  const [frame, setFrame] = useState<Captured | null>(null);
  const [crop, setCrop] = useState<Box | null>(null);
  const [capture, setCapture] = useState<Status>({ kind: 'idle' });
  const [rights, setRights] = useState(false);
  const [rightsNote, setRightsNote] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [detect, setDetect] = useState<Status>({ kind: 'idle' });
  const [cardName, setCardName] = useState('');
  const [fazeMember, setFazeMember] = useState(members[0] ?? '');
  const [rarity, setRarity] = useState<Rarity>('rare');
  const [send, setSend] = useState<Status>({ kind: 'idle' });
  const [result, setResult] = useState<PickResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setCaptureOk(canCaptureTab()), []);
  useEffect(() => { if (!fazeMember && members[0]) setFazeMember(members[0]); }, [members, fazeMember]);

  function load(f: Frame, how: string, stamp: Stamp) {
    setFrame({ ...f, sourceUrl, sourceLabel, stamp, how });
    setCrop(defaultBox(f.width, f.height));
    setJobId(null); setCandidates([]); setPicked(null); setDetect({ kind: 'idle' }); setSend({ kind: 'idle' }); setResult(null);
  }

  async function doCapture() {
    const el = playerEl();
    if (!el) return;
    setCapture({ kind: 'busy', text: 'Choose “This tab” in the browser prompt…' });
    let stamp: Stamp = getStamp();
    try {
      const f = await captureElement(el, () => { stamp = getStamp(); });
      load(f, f.cropped === 'none' ? 'Tab capture (not cropped: another surface was shared)' : 'Tab capture', stamp);
      setCapture({ kind: 'ok', text: f.cropped === 'none' ? 'Captured, but the frame isn’t cropped to the player. Pick “This tab” next time, or crop manually below.' : 'Frame captured. Screen sharing already stopped.' });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setCapture(name === 'NotAllowedError' || name === 'AbortError'
        ? { kind: 'idle', text: 'Capture cancelled.' }
        : { kind: 'error', text: `Capture failed (${e instanceof Error ? e.message : String(e)}). Upload a screenshot instead.` });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const stamp = getStamp();
      load(await frameFromFile(file), `Uploaded ${file.name}`, { ...stamp, label: `${stamp.label} (player position at upload)` });
      setCapture({ kind: 'ok', text: 'Screenshot loaded.' });
    } catch (e) { setCapture({ kind: 'error', text: e instanceof Error ? e.message : 'Could not read that image.' }); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  const rightsReady = rights && rightsNote.trim().length >= 3;

  async function uploadFrame(f: Captured): Promise<FaceFrameResponse> {
    const r = await request<FaceFrameResponse>('/admin/pipeline/face-frame', {
      imageBase64: f.dataUrl.slice(f.dataUrl.indexOf(',') + 1), mimeType: 'image/png',
      sourceUrl: f.sourceUrl, sourceLabel: f.sourceLabel,
      ...(f.stamp.timestampMs !== undefined ? { timestampMs: f.stamp.timestampMs } : { timestampIso: f.stamp.timestampIso }),
      rightsConfirmed: true, rightsNote: rightsNote.trim(),
    });
    setJobId(r.jobId);
    setCandidates([...(r.candidates ?? [])].sort((a, b) => a.rank - b.rank));
    return r;
  }

  async function doDetect() {
    if (!frame || !rightsReady) return;
    setDetect({ kind: 'busy', text: 'Uploading frame and detecting faces…' });
    try {
      const r = await uploadFrame(frame);
      const top = r.candidates?.[0];
      if (top) { setPicked(top.rank); setCrop(cardBoxAround(top.box, frame.width, frame.height)); }
      setDetect({ kind: 'ok', text: r.candidates?.length ? `${r.candidates.length} face${r.candidates.length > 1 ? 's' : ''} found. Click a box to use it.` : 'No faces found. Crop manually.' });
    } catch (e) { setDetect(describe(e, 'detect')); }
  }

  async function doSend() {
    if (!frame || !crop || !rightsReady || !cardName.trim() || !fazeMember.trim()) return;
    setSend({ kind: 'busy', text: jobId ? 'Composing card art…' : 'Uploading frame, then composing card art…' });
    setResult(null);
    try {
      let id = jobId;
      if (!id) {
        try { id = (await uploadFrame(frame)).jobId; }
        catch (e) { setSend(describe(e, 'detect')); return; }
      }
      const r = await request<PickResponse>(`/admin/pipeline/jobs/${encodeURIComponent(id)}/pick`, { box: roundBox(crop), cardName: cardName.trim(), fazeMember: fazeMember.trim(), rarity });
      setResult(r);
      setSend({ kind: 'ok', text: 'Draft created. It still needs the rights/approval gate in the Control Room.' });
    } catch (e) { setSend(describe(e, 'pick')); }
  }

  const msg = (s: Status) => s.text ? <p className={`watch-lab-msg ${s.kind}`} role={s.kind === 'error' || s.kind === 'auth' || s.kind === 'missing' ? 'alert' : 'status'}>
    {s.text}{s.kind === 'auth' && <> <a href="/admin">Open /admin →</a></>}
  </p> : null;
  const draftName = typeof result?.draft?.name === 'string' ? result.draft.name : cardName;
  const draftStatus = typeof result?.draft?.status === 'string' ? result.draft.status : 'draft';

  return <section className="watch-lab panel" aria-labelledby="clip-lab-title">
    <div className="watch-lab-head">
      <div><p className="eyebrow">CLIP LAB / STAFF</p><h2 id="clip-lab-title">Capture a moment</h2>
        <p className="watch-hint">Grab one frame of the player, crop it to a card, and send it to card generation. Official FaZe content only.</p></div>
      <div className="watch-lab-actions">
        {captureOk && canEmbed && <button className="primary" onClick={doCapture} disabled={capture.kind === 'busy'}>{frame ? 'Re-capture moment' : 'Capture moment'}</button>}
        <button onClick={() => fileInput.current?.click()}>{captureOk ? 'Upload a frame' : 'Upload a screenshot'}</button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => onFile(e.target.files?.[0])} />
      </div>
    </div>
    {!captureOk && <p className="watch-hint">This browser can’t capture the tab (common on Safari and phones). Take a screenshot of the stream and upload it.</p>}
    {msg(capture)}

    {frame && crop && <div className="watch-lab-body">
      <div className="watch-lab-frame">
        <CropEditor src={frame.dataUrl} W={frame.width} H={frame.height} crop={crop} onCrop={b => { setCrop(b); setPicked(null); }}
          candidates={candidates} picked={picked} onPickCandidate={c => { setPicked(c.rank); setCrop(cardBoxAround(c.box, frame.width, frame.height)); }} />
        <dl className="watch-lab-meta">
          <div><dt>Source</dt><dd><a href={frame.sourceUrl} target="_blank" rel="noreferrer">{frame.sourceLabel}</a></dd></div>
          <div><dt>Moment</dt><dd>{frame.stamp.label}</dd></div>
          <div><dt>Frame</dt><dd>{frame.width}×{frame.height} · {frame.how}</dd></div>
          <div><dt>Crop</dt><dd>{Object.values(roundBox(crop)).join(', ')} (x, y, w, h)</dd></div>
        </dl>
        <p className="watch-hint">Drag on the frame to draw a 5:6 card crop, drag the box to move it, or the corner to resize. Arrow keys nudge.</p>
      </div>

      <div className="watch-lab-side">
        <CropPreview src={frame.dataUrl} W={frame.width} H={frame.height} crop={crop} />

        <fieldset className="watch-rights">
          <legend>Rights (required before upload)</legend>
          <label className="watch-check"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />
            This frame is official FaZe content we have the right to use.</label>
          <label>Rights note<input value={rightsNote} onChange={e => setRightsNote(e.target.value)} placeholder="e.g. FaZe official Twitch VOD, owned media" maxLength={280} /></label>
        </fieldset>

        <div className="watch-lab-step">
          <button onClick={doDetect} disabled={!rightsReady || detect.kind === 'busy'}>{detect.kind === 'busy' ? 'Detecting…' : candidates.length ? 'Detect again' : 'Detect faces'}</button>
          {!rightsReady && <small>Confirm rights and add a note to enable upload.</small>}
          {msg(detect)}
          {candidates.some(c => c.previewUrl) && <div className="watch-cand-list">
            {candidates.map(c => <button key={c.rank} type="button" aria-pressed={picked === c.rank} onClick={() => { setPicked(c.rank); setCrop(cardBoxAround(c.box, frame.width, frame.height)); }}>
              {c.previewUrl ? <img src={art(c.previewUrl)} alt="" /> : null}<span>#{c.rank}</span>
            </button>)}
          </div>}
        </div>

        <form className="watch-lab-step watch-gen" onSubmit={e => { e.preventDefault(); doSend(); }}>
          <h3>SEND TO CARD GENERATION</h3>
          <label>Card name<input value={cardName} onChange={e => setCardName(e.target.value)} required maxLength={60} placeholder="e.g. Clutch 1v4" /></label>
          <label>FaZe member<input value={fazeMember} onChange={e => setFazeMember(e.target.value)} required maxLength={40} list="watch-members" /></label>
          <datalist id="watch-members">{members.map(m => <option key={m} value={m} />)}</datalist>
          <label>Rarity<select value={rarity} onChange={e => setRarity(e.target.value as Rarity)}>{RARITIES.map(r => <option key={r}>{r}</option>)}</select></label>
          <button className="primary" disabled={!rightsReady || send.kind === 'busy' || !cardName.trim() || !fazeMember.trim()}>{send.kind === 'busy' ? 'Generating…' : 'Send to card generation'}</button>
          {msg(send)}
        </form>

        {result && <div className="watch-lab-result">
          <article className={`watch-card ${rarity}`}>
            <div className="watch-card-art"><img src={art(result.artUrl)} alt={draftName} /><span className="watch-demo">{draftStatus.toUpperCase()}</span></div>
            <small>{fazeMember}</small><h4>{draftName}</h4>
          </article>
          <a className="watch-button" href="/admin/control/studio">Continue in Control Room Studio →</a>
        </div>}
      </div>
    </div>}
  </section>;
}
