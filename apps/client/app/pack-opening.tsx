'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent }  from 'react';
import type { Card, CardInstance } from '@faze/shared';
import { art } from '../lib/api';
import { playGoodPull, stopCardVoice } from '../lib/voice';
import { packCoverForName } from '../lib/pack-covers';
import { DecodeText, GlitchOverlay, RARITY_RANK, glitchLevel, trackSpotlight } from './pack-fx';
import './pack-fx.css';

const colors = { common: '#a9bed1', rare: '#42baff', epic: '#be75ff', legendary: '#ffd270' };
// Finished card faces (artwork already has the title, date, lore and frame) get a silver or gold treatment: the silver one is the
// 'rare' tier face, the gold ones are the epic/legendary tier faces. Fields are additive on the API card payload.
type Extras = { lore?: string; faceBaked?: boolean; hasVoice?: boolean };
const extra = (c: Card) => c as Card & Extras;
const tierOf = (c: Card): 'silver' | 'gold' | null => !extra(c).faceBaked ? null : c.rarity === 'rare' ? 'silver' : 'gold';
const TIER_COLOR = { silver: '#dfe7f0', gold: '#ffd270' };
export default function PackOpening({ cards, packName, onClose }: { cards: CardInstance[]; packName?: string; onClose: () => void }) {
  const [stage, setStage] = useState<'sealed' | 'opening' | 'cards' | 'summary'>('sealed');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tearProgress, setTearProgress] = useState(0);
  const drag = useRef<{ id: number; x: number; width: number; progress: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Display order only (rarest last, for suspense); still exactly the cards the server returned.
  // Packs that end on finished card faces (silver, then gold) are shown in the server's slot order; other packs keep rarest-last.
  const shown = useMemo(() => cards.length > 1 && extra(cards[cards.length - 1].card).faceBaked ? cards : [...cards].sort((a, b) => RARITY_RANK[a.card.rarity] - RARITY_RANK[b.card.rarity]), [cards]);
  useEffect(() => () => stopCardVoice(), []);
  const glitched = useRef(new Set<string>());
  const [glitch, setGlitch] = useState<string | null>(null);
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
  const current = shown[index];
  if (!current) return null;
  const tier = tierOf(current.card);
  const baked = !!extra(current.card).faceBaked;
  const hasVoice = !!extra(current.card).hasVoice;
  const color = tier ? TIER_COLOR[tier] : colors[current.card.rarity];
  const seamPoints = Array.from({ length: 51 }, (_, n) =>     n * 5 + ',' + ([8, 4, 10, 6, 12, 5, 9][n % 7])).join(' ');
  const level = glitchLevel(current.card.rarity);
  function next() { stopCardVoice(); if (index === shown.length - 1) setStage('summary'); else { setIndex(index + 1); setFlipped(false); } }
  function reveal() {
    setFlipped(true);
    // A good pull (silver/gold faces, epic and up) gets a party sound, then its story plays by itself: no button.
    if (tier || level) playGoodPull(hasVoice ? current.card.id : null, tier === 'gold' || current.card.rarity === 'legendary' ? 'gold' : 'silver');
    if (level && !glitched.current.has(current.id)) { glitched.current.add(current.id); setGlitch(current.id); } }
  const glitching = stage === 'cards' && level && glitch === current.id ? level : null;
  return <div className={`pack-cinema cinema-${stage}${glitching ? ` fx-gl-${glitching}` : ''}`} style={{ '--rarity-glow': color } as CSSProperties}>
    <div ref={panel} tabIndex={-1} className="cinema-dialog" role="dialog" aria-modal="true" aria-labelledby="opening-title">
      <div className="cinema-top"><span>FAZE CLIPDECK / PACK REVEAL</span><button onClick={onClose} aria-label="Close pack reveal">Close ×</button></div>
      <div className="cinema-floor" aria-hidden="true" />
      <div className="cinema-copy"><p className="eyebrow">{stage === 'summary' ? 'YOUR COLLECTION JUST GOT STRONGER' : stage === 'cards' && flipped && tier ? `${tier.toUpperCase()} EDITION` : 'EVERY PACK HAS A STORY'}</p><h2 id="opening-title">{stage === 'sealed' ? 'Rip. Reveal. Collect.' : stage === 'opening' ? 'Seal removed.' : stage === 'summary' ? 'Meet your new lineup.' : flipped ? current.card.name : 'Who’s inside?'}</h2><p aria-live="polite">{stage === 'cards' ? `Card ${index + 1} of ${shown.length}${flipped ? ` · ${current.card.rarity}` : ' · Tap to reveal'}` : stage === 'sealed' ? 'Pinch the notched corner. Pull right to tear across the foil.' : 'These cards are already safely added to your collection.'}</p></div>
      {(stage === 'sealed' || stage === 'opening') && <div className={`cinema-booster has-cover ${stage === 'opening' ? 'tearing' : ''} ${tearProgress > 0 && stage === 'sealed' ? 'is-dragging' : ''}`} style={{ '--tear-progress': tearProgress, '--pack-cover': `url(${packCoverForName(packName ?? '')})` } as CSSProperties}>
        <span className="booster-cover" aria-hidden="true" />
        <span className="booster-mouth" aria-hidden="true"><span className="booster-inner-cards" /></span>
        <svg className="booster-tear-seam" viewBox="0 0 250 18" preserveAspectRatio="none" aria-hidden="true"><polyline points={seamPoints} /></svg>
        <button className="booster-top-seal" disabled={stage !== 'sealed'} onPointerDown={startTear} onPointerMove={moveTear} onPointerUp={endTear} onPointerCancel={() => { if (drag.current) { drag.current = null; } }} onLostPointerCapture={() => { if (drag.current) { drag.current = null; } }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); removeSeal(); } }} aria-label="Tear the notched foil corner to the right, or press Enter or Space."><span className="seal-intact" aria-hidden="true"><span className="seal-foil"><span>COLLECTOR SERIES</span></span></span><span className="seal-loose" aria-hidden="true"><span className="seal-foil"><span>COLLECTOR SERIES</span></span></span><span className="seal-grip" aria-hidden="true"><span>PINCH</span><b>→</b></span></button>
        <span className="booster-seal">COLLECTOR SERIES / DEMO</span><span className="booster-logo">CLIPDECK</span><span className="booster-vault">COLLECTOR SERIES</span><span className="booster-count">{cards.length} CARDS INSIDE</span><span className="booster-tear">{stage === 'opening' ? 'TOP REMOVED' : 'PINCH THE CORNER · PULL RIGHT'}</span>
      </div>}
      {stage === 'cards' && <div className={`cinema-card-stage fx-stage fx-r-${current.card.rarity}${tier ? ` tier-${tier}` : ''}${baked ? ' is-baked' : ''}${index === 0 ? ' fx-first' : ''}${flipped ? ' fx-revealed' : ''}`} key={current.id}>
        <span className="fx-deck" aria-hidden="true">{shown.slice(index + 1, index + 5).map((item, n) => <span key={item.id} style={{ '--i': n } as CSSProperties} />)}</span>
        {flipped && <div className="rarity-rays" aria-hidden="true" />}
        <button className={`cinema-flipper ${flipped ? 'is-flipped' : ''}`} onClick={() => flipped ? next() : reveal()} onPointerMove={trackSpotlight} aria-label={!flipped ? 'Reveal card' : `${current.card.name}, ${tier ?? current.card.rarity}. Continue.`}>
          <span className="cinema-card-back"><b>CLIPDECK</b><span>CLIPDECK / COLLECTOR CARD</span><small>TAP TO REVEAL</small></span>
          <span className="cinema-card-front">{!baked && <span className="cinema-rarity" data-text={current.card.rarity}>{current.card.rarity}</span>}<img src={art(current.card.artUrl)} alt={current.card.name} />{!baked && <span className="cinema-card-label"><small>{current.card.fazeMember}</small><strong data-text={current.card.name}><DecodeText text={current.card.name} play={flipped && current.card.rarity === 'legendary'} /></strong><span>POWER {current.card.basePower} · SERIAL #{current.serial}</span></span>}<span className="card-foil" aria-hidden="true" /></span>
        </button>
      </div>}
      {stage === 'cards' && flipped && !baked && extra(current.card).lore && <p className="cinema-lore">{extra(current.card).lore}</p>}
      {stage === 'summary' && <div className="cinema-lineup">{shown.map((item, n) => <article key={item.id} className={`fx-r-${item.card.rarity}${tierOf(item.card) ? ` tier-${tierOf(item.card)} is-baked` : ''}`} style={{ '--rarity-glow': tierOf(item.card) ? TIER_COLOR[tierOf(item.card)!] : colors[item.card.rarity], '--card-order': n } as CSSProperties}><img src={art(item.card.artUrl)} alt={item.card.name} /><small>{tierOf(item.card) ? `${tierOf(item.card)} edition` : item.card.rarity}</small><h3>{item.card.name}</h3>{!extra(item.card).faceBaked && extra(item.card).lore && <p className="lineup-lore">{extra(item.card).lore}</p>}<span>#{item.serial} · {item.card.basePower} POWER</span></article>)}</div>}
      <div className="cinema-controls">{stage === 'sealed' && <button className="primary" onClick={removeSeal}>Remove top seal</button>}{stage === 'cards' && <button className="primary" onClick={() => flipped ? next() : reveal()}>{!flipped ? 'Reveal card' : index === shown.length - 1 ? 'See full lineup' : 'Next card →'}</button>}{stage === 'summary' ? <button className="primary" onClick={onClose}>Keep collecting</button> : <button onClick={() => setStage('summary')}>Reveal all · Skip animation</button>}</div>
      <p className="fx-sr" aria-live="assertive">{stage === 'cards' && flipped && level ? `${level === 'legendary' ? 'Legendary' : 'Epic'} pull!` : ''}</p>
    </div>
    {glitching && <GlitchOverlay key={current.id} level={glitching} onDone={() => setGlitch(null)} />}
  </div>;
}
