'use client';
// The popup card that appears when chat spikes: collect it with demo coins, straight from the stream.
import { useEffect, useState } from 'react';
import { ApiError, request, thumb } from '../../lib/api';
import { playCardVoice, stopCardVoice } from '../../lib/voice';

export type Offer = { card: { id: string; name: string; artUrl: string; rarity: string; hasVoice?: boolean }; priceCoins: number; owned: boolean; balance: number };
type Phase = 'idle' | 'buying' | 'done' | 'error';

function key() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) { try { return crypto.randomUUID(); } catch { /* insecure context */ } }
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function HypePopup({ offer, channel, score, demo, signedIn, onClose, onCollected }: {
  offer: Offer; channel: string; score: number; demo: boolean; signedIn: boolean; onClose: () => void; onCollected: (balance: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState('');
  const [serial, setSerial] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [retryKey] = useState(key); // one key per popup: a retry after a dropped connection can never charge twice

  // The announcer calls it out as the popup appears. Browsers may block audio before any interaction: that is fine, it just stays silent.
  useEffect(() => { playCardVoice('hype-alert').catch(() => {}); return () => stopCardVoice(); }, []);
  useEffect(() => { // fade away if ignored
    if (phase !== 'idle') return;
    const t = setTimeout(onClose, 45_000);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  async function collect() {
    setPhase('buying'); setMsg('');
    try {
      const r = await request<{ instance: { serial: number }; balance: number }>('/moments/hype/claim', { channel, hypeScore: Math.round(score * 10) / 10, idempotencyKey: retryKey });
      setSerial(r.instance.serial); setBalance(r.balance); setPhase('done'); onCollected(r.balance);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Something went wrong. You were not charged.'); setPhase('error');
    }
  }
  function toggleVoice() {
    if (speaking) { stopCardVoice(); return; }
    setSpeaking(true); playCardVoice(offer.card.id, () => setSpeaking(false)).catch(() => setSpeaking(false));
  }

  return <aside className={`hype-popup${phase === 'done' ? ' is-done' : ''}`} role="dialog" aria-label="Hype moment card" aria-live="polite">
    <button type="button" className="hype-popup-x" onClick={onClose} aria-label="Dismiss">×</button>
    <p className="hype-popup-eyebrow">{demo ? 'DEMO · ' : ''}HYPE MOMENT · CHAT IS GOING WILD</p>
    <img src={thumb(offer.card.artUrl, 520)} alt={offer.card.name} />
    <h3>{offer.card.name}</h3>
    {phase === 'done' ? <>
      <p className="hype-popup-ok" role="status">Collected! You got #{serial}. {balance !== null && `${balance} coins left.`}</p>
      <div className="hype-popup-row">
        {offer.card.hasVoice && <button type="button" onClick={toggleVoice}>{speaking ? '■ Stop' : '▶ Hear its legacy'}</button>}
        <button type="button" onClick={onClose}>Back to the stream</button>
      </div>
    </> : !signedIn ? <>
      <p>Sign in to collect it straight from the stream.</p>
      <div className="hype-popup-row"><a className="hype-popup-cta" href="/">Sign in</a><button type="button" onClick={onClose}>Not now</button></div>
    </> : <>
      <p>A limited card, dropped because chat just exploded. {demo ? 'Demo prices and coins.' : ''}</p>
      {phase === 'error' && <p className="hype-popup-err" role="alert">{msg}</p>}
      <div className="hype-popup-row">
        <button type="button" className="hype-popup-cta" disabled={phase === 'buying'} onClick={collect}>{phase === 'buying' ? 'Collecting…' : phase === 'error' ? 'Try again' : `Collect · ${offer.priceCoins} coins`}</button>
        <button type="button" onClick={onClose}>Not now</button>
      </div>
      <small>You have {offer.balance} coins (demo). One copy per collector.</small>
    </>}
  </aside>;
}
