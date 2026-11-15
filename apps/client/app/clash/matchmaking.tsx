'use client';
// "Searching the world" animation that lands on the (demo) opponent. The opponent in this demo is the computer, and says so.
import { useEffect, useState } from 'react';
import { allPlaces, type Opponent } from './opponent';

export default function Matchmaking({ opponent, onFound }: { opponent: Opponent; onFound: () => void }) {
  const [shown, setShown] = useState<{ city: string; country: string; flag: string } | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const places = allPlaces();
    let i = Math.floor(Math.random() * places.length), spins = 0;
    const MAX = reduced ? 0 : 16;
    const t = setInterval(() => {
      if (spins >= MAX) { clearInterval(t); setShown({ city: opponent.city, country: opponent.country, flag: opponent.flag }); setLocked(true); setTimeout(onFound, reduced ? 400 : 1500); return; }
      setShown(places[i++ % places.length]); spins++;
    }, 110);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="cg-search" role="status" aria-live="polite">
    <div className={`cg-globe${locked ? ' is-locked' : ''}`} aria-hidden="true"><span /><span /><span /></div>
    <p className="cg-eyebrow">{locked ? 'OPPONENT FOUND' : 'SEARCHING THE WORLD…'}</p>
    <h3 className="cg-search-place">{shown ? <>{shown.flag} {shown.city}, {shown.country}</> : '…'}</h3>
    {locked ? <p className="cg-search-who"><b>{opponent.handle}</b> · {opponent.ping} ms <em>DEMO: computer opponent</em></p> : <p className="cg-search-who">Finding a challenger</p>}
  </section>;
}
