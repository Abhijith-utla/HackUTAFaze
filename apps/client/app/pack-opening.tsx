'use client';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent }  from 'react';
import type { CardInstance } from '@faze/shared';
import { art } from '../lib/api';

const colors = { common: '#a9bed1', rare: '#42baff', epic: '#be75ff', legendary: '#ffd270' };
export default function PackOpening({ cards, onClose }: { cards: CardInstance[]; onClose: () => void }) {
  const [stage, setStage] = useState<'sealed' | 'opening' | 'cards' | 'summary'>('sealed');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tearProgress, setTearProgress] = useState(0);
  const drag = useRef<{ id: number; x: number; width: number; progress: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  function removeSeal() {
    drag.current = null;
    setTearProgress(1);
    setStage('opening');
  }
  function startTear(event: PointerEvent<HTMLButtonElement>) {
    if (stage !== 'sealed' || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = { id: event.pointerId, x: event.clientX, width: event.currentTarget.getBoundingClientRect().width * .7, progress: tearProgress };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveTear(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const progress = Math.min(1, Math.max(active.progress, active.progress + (event.clientX - active.x) / active.width));
    setTearProgress(progress);
    if (progress === 1) removeSeal();
  }
  function endTear(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const progress = Math.min(1, Math.max(drag.current.progress, drag.current.progress + (event.clientX - drag.current.x) / drag.current.width));
    drag.current = null;
    if (progress >= .95) removeSeal(); else setTearProgress(progress);
  }
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (!buttons.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (stage !== 'opening') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setStage('cards'), reduced ? 0 : 1100);
    return () => clearTimeout(timer);
  }, [stage]);
  const current = cards[index];
  if (!current) return null;
  const color = colors[current.card.rarity];
  const seamPoints = Array.from({ length: 51 }, (_, n) =>     n * 5 + ',' + ([8, 4, 10, 6, 12, 5, 9][n % 7])).join(' ');
  function next() { if (index === cards.length - 1) setStage('summary'); else { setIndex(index + 1); setFlipped(false); } }
  return <div className={`pack-cinema cinema-${stage}`} style={{ '--rarity-glow': color } as CSSProperties}>
    <div ref={panel} tabIndex={-1} className="cinema-dialog" role="dialog" aria-modal="true" aria-labelledby="opening-title">
      <div className="cinema-top"><span>FAZE VAULT / PACK REVEAL</span><button onClick={onClose} aria-label="Close pack reveal">Close ×</button></div>
      <div className="cinema-floor" aria-hidden="true" />
      <div className="cinema-copy"><p className="eyebrow">{stage === 'summary' ? 'YOUR COLLECTION JUST GOT STRONGER' : 'EVERY PACK HAS A STORY'}</p><h2 id="opening-title">{stage === 'sealed' ? 'Rip. Reveal. Collect.' : stage === 'opening' ? 'Seal removed.' : stage === 'summary' ? 'Meet your new lineup.' : flipped ? current.card.name : 'Who’s inside?'}</h2><p aria-live="polite">{stage === 'cards' ? `Card ${index + 1} of ${cards.length}${flipped ? ` · ${current.card.rarity}` : ' · Tap to reveal'}` : stage === 'sealed' ? 'Pinch the notched corner. Pull right to tear across the foil.' : 'These cards are already safely added to your collection.'}</p></div>
      {(stage === 'sealed' || stage === 'opening') && <div className={`cinema-booster ${stage === 'opening' ? 'tearing' : ''} ${tearProgress > 0 && stage === 'sealed' ? 'is-dragging' : ''}`} style={{ '--tear-progress': tearProgress } as CSSProperties}>
        <span className="booster-mouth" aria-hidden="true"><span className="booster-inner-cards" /></span>
        <svg className="booster-tear-seam" viewBox="0 0 250 18" preserveAspectRatio="none" aria-hidden="true"><polyline points={seamPoints} /></svg>
        <button className="booster-top-seal" disabled={stage !== 'sealed'} onPointerDown={startTear} onPointerMove={moveTear} onPointerUp={endTear} onPointerCancel={() => { if (drag.current) { drag.current = null; } }} onLostPointerCapture={() => { if (drag.current) { drag.current = null; } }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); removeSeal(); } }} aria-label="Tear the notched foil corner to the right, or press Enter or Space."><span className="seal-intact" aria-hidden="true"><span className="seal-foil"><span>COLLECTOR SERIES</span></span></span><span className="seal-loose" aria-hidden="true"><span className="seal-foil"><span>COLLECTOR SERIES</span></span></span><span className="seal-grip" aria-hidden="true"><span>PINCH</span><b>→</b></span></button>
        <span className="booster-seal">COLLECTOR SERIES / DEMO</span><span className="booster-logo">FΛZE</span><span className="booster-vault">VAULT</span><span className="booster-count">{cards.length} CARDS INSIDE</span><span className="booster-tear">{stage === 'opening' ? 'TOP REMOVED' : 'PINCH THE CORNER · PULL RIGHT'}</span>
      </div>}
      {stage === 'cards' && <div className="cinema-card-stage" key={current.id}>
        {flipped && <div className="rarity-rays" aria-hidden="true" />}
        <button className={`cinema-flipper ${flipped ? 'is-flipped' : ''}`} onClick={() => flipped ? next() : setFlipped(true)} aria-label={flipped ? `${current.card.name}, ${current.card.rarity}. Continue.` : 'Reveal card'}>
          <span className="cinema-card-back"><b>FΛZE</b><span>VAULT / COLLECTOR CARD</span><small>TAP TO REVEAL</small></span>
          <span className="cinema-card-front"><span className="cinema-rarity">{current.card.rarity}</span><img src={art(current.card.artUrl)} alt={current.card.name} /><span className="cinema-card-label"><small>{current.card.fazeMember}</small><strong>{current.card.name}</strong><span>POWER {current.card.basePower} · SERIAL #{current.serial}</span></span><span className="card-foil" aria-hidden="true" /></span>
        </button>
      </div>}
      {stage === 'summary' && <div className="cinema-lineup">{cards.map((item, n) => <article key={item.id} style={{ '--rarity-glow': colors[item.card.rarity], '--card-order': n } as CSSProperties}><img src={art(item.card.artUrl)} alt={item.card.name} /><small>{item.card.rarity}</small><h3>{item.card.name}</h3><span>#{item.serial} · {item.card.basePower} POWER</span></article>)}</div>}
      <div className="cinema-controls">{stage === 'sealed' && <button className="primary" onClick={removeSeal}>Remove top seal</button>}{stage === 'cards' && <button className="primary" onClick={() => flipped ? next() : setFlipped(true)}>{!flipped ? 'Reveal card' : index === cards.length - 1 ? 'See full lineup' : 'Next card →'}</button>}{stage === 'summary' ? <button className="primary" onClick={onClose}>Keep collecting</button> : <button onClick={() => setStage('summary')}>Reveal all · Skip animation</button>}</div>
    </div>
  </div>;
}
