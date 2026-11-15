// Pack-reveal audio. The UI only calls playGoodPull() (a party sound, then the card's story) and playCardVoice() (just the story):
// to swap the narrator, regenerate the files in public/voice (content/seed/demo-cards/voice/) or point NEXT_PUBLIC_VOICE_BASE at any
// host that serves <card id>.mp3, party-silver.mp3 and party-gold.mp3. Nothing else needs to change. Missing files are skipped silently.
const BASE = (process.env.NEXT_PUBLIC_VOICE_BASE ?? '/voice').replace(/\/$/, '');

let token = 0;                       // bumped on every start/stop so a stopped sequence can't keep going
let current: HTMLAudioElement | null = null;
let resolveCurrent: ((ok: boolean) => void) | null = null;
let onEndCurrent: (() => void) | null = null;

export function stopCardVoice() {
  token++;
  if (current) { current.pause(); current.src = ''; }
  current = null;
  resolveCurrent?.(false); resolveCurrent = null;
  const end = onEndCurrent; onEndCurrent = null;
  end?.();
}

/** Plays one file to the end. Resolves false if it can't play (missing file, autoplay blocked) or was stopped. */
function playFile(url: string, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (t !== token) return resolve(false);
    const a = new Audio(url);
    current = a; resolveCurrent = resolve;
    const done = (ok: boolean) => { if (current === a) { current = null; resolveCurrent = null; } resolve(ok); };
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.play().catch(() => done(false));
  });
}

function begin(onEnd?: () => void) { stopCardVoice(); onEndCurrent = onEnd ?? null; return token; }
function finish(t: number) { if (t !== token) return; const end = onEndCurrent; onEndCurrent = null; end?.(); }

/** A celebration sound for a good pull, then (if the card has one) its story, automatically. `kind` picks the party: silver/epic or gold/legendary. */
export async function playGoodPull(cardId: string | null, kind: 'silver' | 'gold', onEnd?: () => void): Promise<void> {
  const t = begin(onEnd);
  await playFile(`${BASE}/party-${kind}.mp3`, t);
  if (t !== token) return;
  if (cardId) { await new Promise((r) => setTimeout(r, 120)); await playFile(`${BASE}/${cardId}.mp3`, t); }
  finish(t);
}

/** Just a clip by name or card id (the story, or the hype call-out). Rejects if it can't start so callers can ignore it. */
export async function playCardVoice(cardId: string, onEnd?: () => void): Promise<void> {
  const t = begin(onEnd);
  const ok = await playFile(`${BASE}/${cardId}.mp3`, t);
  if (!ok && t === token) { finish(t); throw new Error('voice unavailable'); }
  finish(t);
}
