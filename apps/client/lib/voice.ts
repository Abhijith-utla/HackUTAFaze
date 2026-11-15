// Card narration playback. The ONLY thing the UI calls is playCardVoice(cardId): to swap in a voice agent later, point
// NEXT_PUBLIC_VOICE_BASE at a host that serves <card id>.mp3, or replace this function (see public/voice/README.md).
const BASE = (process.env.NEXT_PUBLIC_VOICE_BASE ?? '/voice').replace(/\/$/, '');
let current: HTMLAudioElement | null = null;
let currentEnd: (() => void) | null = null;

export function stopCardVoice() {
  if (current) { current.pause(); current.src = ''; }
  const end = currentEnd;
  current = null; currentEnd = null;
  end?.();
}

/** Starts the narration for a card (stopping any other). Resolves once playback has started; `onEnd` fires when it finishes or is stopped. */
export async function playCardVoice(cardId: string, onEnd?: () => void): Promise<void> {
  stopCardVoice();
  const audio = new Audio(`${BASE}/${cardId}.mp3`);
  current = audio; currentEnd = onEnd ?? null;
  audio.onended = () => { if (current === audio) { current = null; const end = currentEnd; currentEnd = null; end?.(); } };
  audio.onerror = () => { if (current === audio) stopCardVoice(); };
  try { await audio.play(); }
  catch (e) { if (current === audio) stopCardVoice(); throw e; }
}
