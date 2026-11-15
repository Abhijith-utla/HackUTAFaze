'use client';
// Card Clash: pick a team in a popup -> see the lineup -> start -> search for an opponent (demo: the computer) -> battle on a FaZe card table.
// All rules, scoring and the computer's plays are the server's (/game/*); this component is only the flow and the screens.
import type { ClashState } from '@faze/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../../lib/api';
import Battle from './battle';
import Lineup from './lineup';
import Matchmaking from './matchmaking';
import { opponentFor } from './opponent';
import TeamPicker, { TEAM_SIZE } from './picker';
import type { PlayCard } from './view';
import './clash.css';

type Phase = 'loading' | 'idle' | 'lineup' | 'searching' | 'battle';
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function Clash({ userId }: { userId: string }) {
  const [cards, setCards] = useState<PlayCard[] | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<ClashState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resumed = useRef(false);

  const distinct = useMemo(() => (cards ?? []).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i), [cards]);
  const teamCards = useMemo(() => team.map((id) => distinct.find((c) => c.id === id)).filter(Boolean) as PlayCard[], [team, distinct]);
  const opponent = useMemo(() => opponentFor(state?.match.id ?? userId), [state?.match.id, userId]);

  const loadCards = useCallback(async () => {
    const r = await request<{ cards: PlayCard[] }>('/game/cards');
    setCards(r.cards);
    return r.cards;
  }, []);

  // On open: resume an unfinished match, else start with the team popup straight away.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    (async () => {
      try {
        const { matches } = await request<{ matches: { id: string; status: string; mode: string }[] }>('/game/matches');
        const live = matches.find((m) => m.status === 'active' && m.mode === 'cpu');
        if (live) { setState(await request<ClashState>(`/game/matches/${live.id}`)); setPhase('battle'); await loadCards(); return; }
        const list = await loadCards();
        if (new Set(list.map((c) => c.id)).size >= TEAM_SIZE) { setPhase('idle'); setPickerOpen(true); } else setPhase('idle');
      } catch (e) { setError(msg(e)); setPhase('idle'); }
    })();
  }, [loadCards]);

  const onPicked = useCallback((ids: string[]) => { setTeam(ids); setPickerOpen(false); setPhase('lineup'); }, []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function start() {
    if (busy || teamCards.length !== TEAM_SIZE) return;
    setBusy(true); setError('');
    let matchId: string | null = null;
    try {
      matchId = (await request<ClashState>('/game/matches', { mode: 'cpu' })).match.id;
      const ready = await request<ClashState>(`/game/matches/${matchId}/lineup`, { instanceIds: teamCards.map((c) => c.instance_id) });
      setState(ready); setSelected(null); setReveal(null); setPhase('searching');
    } catch (e) {
      if (matchId) request(`/game/matches/${matchId}/cancel`, {}).catch(() => {}); // don't leave a half-made match behind
      setError(msg(e));
    } finally { setBusy(false); }
  }

  async function play() {
    if (!state || !selected || busy) return;
    const round = state.match.current_round;
    setBusy(true); setError('');
    try {
      setState(await request<ClashState>(`/game/matches/${state.match.id}/submit`, { cardId: selected, round }));
      setSelected(null); setReveal(round);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  const reset = useCallback(async () => {
    setState(null); setSelected(null); setReveal(null); setTeam([]); setError('');
    try { await loadCards(); } catch (e) { setError(msg(e)); }
    setPhase('idle'); setPickerOpen(true);
  }, [loadCards]);

  async function forfeit() {
    if (!state || busy) return;
    if (!window.confirm('Forfeit this match? Your cards are returned and no point is scored.')) return;
    setBusy(true);
    try { await request(`/game/matches/${state.match.id}/cancel`, {}); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
    await reset();
  }

  const enough = distinct.length >= TEAM_SIZE;
  return <section className="cg-root" aria-label="Card Clash">
    {error && <p className="cg-error" role="alert">{error}</p>}

    {phase === 'loading' && <p className="cg-note" role="status">Setting up the table…</p>}

    {phase === 'idle' && <div className="cg-table cg-idle">
      <div className="cg-top"><div className="cg-prompt"><p className="cg-eyebrow">CARD CLASH</p><h3>Build your team</h3>
        <p>{enough ? 'Choose five cards from your collection, then battle a challenger from somewhere in the world.' : `You need ${TEAM_SIZE} different playable cards to battle. You have ${distinct.length}. Open a pack from the Store to add more.`}</p></div></div>
      <div className="cg-actions cg-idle-actions">{enough ? <button type="button" className="cg-primary" onClick={() => setPickerOpen(true)}>Choose your team</button> : <span className="cg-note">Open packs in the Store, then come back.</span>}</div>
    </div>}

    {phase === 'lineup' && <Lineup team={teamCards} busy={busy} onStart={start} onChange={() => setPickerOpen(true)} />}

    {phase === 'searching' && state && <div className="cg-table cg-searching"><Matchmaking opponent={opponent} onFound={() => setPhase('battle')} /></div>}

    {phase === 'battle' && state && <Battle state={state} opponent={opponent} selected={selected} onSelect={setSelected} onPlay={play} busy={busy}
      reveal={reveal} onContinue={() => setReveal(null)} onLeave={forfeit} onAgain={reset} />}

    {pickerOpen && cards && <TeamPicker cards={cards} initial={team} onDone={onPicked} onClose={closePicker} />}
  </section>;
}
