'use client';
import type { ReactNode } from 'react';
import type { LeaderboardResponse } from '@faze/shared';
import './leaderboard.css';

const PLACES = [1, 2, 3] as const;
const MEDAL = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' } as const;
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Top collectors: a quiet podium, the merch prize for the top three, the viewer's own standing, then compact rows. */
export default function LeaderboardTab({ board, meId, trending }: { board: LeaderboardResponse; meId: string; trending: ReactNode }) {
  const rows = board.collectors;
  const mine = rows.findIndex(r => r.user.id === meId);
  const third = rows[2]?.score;
  const gap = mine > 2 && third !== undefined ? third - rows[mine].score + 1 : 0;
  return <div className="lb">
    <div className="lb-top">
      <ol className="lb-podium" aria-label="Top three collectors">
        {PLACES.map(place => {
          const row = rows[place - 1];
          return <li key={place} className={`lb-pod lb-pod-${place}${row?.user.id === meId ? ' lb-me' : ''}`}>
            <span className="lb-medal">{MEDAL[place]}</span>
            <span className="lb-avatar" aria-hidden="true">{row ? initials(row.user.displayName) : '–'}</span>
            <strong className="lb-name">{row ? row.user.displayName : 'Open spot'}</strong>
            <span className="lb-pts">{row ? `${row.score} pts` : 'Up for grabs'}</span>
            <b className="lb-place" aria-hidden="true">{place}</b>
          </li>;
        })}
      </ol>
      <aside className="lb-prize" aria-label="Top three prize">
        <img src="/prizes/hoodie.webp" alt="FaZe Clan × A Bathing Ape red camo hoodie" width={140} height={175} />
        <div>
          <p className="lb-eyebrow">Top 3 prize</p>
          <h3>FaZe Clan × BAPE camo hoodie</h3>
          <p>The three highest-scoring collectors each win one.</p>
          <span className="lb-demo">Demo prize</span>
        </div>
      </aside>
    </div>

    {mine >= 0 && <p className="lb-you" role="status">{mine < 3
      ? <>You are <b>#{mine + 1}</b> with {rows[mine].score} pts. You are in prize position, so hold it.</>
      : <>You are <b>#{mine + 1}</b> with {rows[mine].score} pts. <b>{gap} more {gap === 1 ? 'point' : 'points'}</b> puts you in the top 3.</>}</p>}
    {mine < 0 && rows.length > 0 && <p className="lb-you" role="status">You are not in the top {rows.length} yet. Open packs and trade up to climb.</p>}

    {rows.length > 3 && <ol className="lb-rows" start={4}>
      {rows.slice(3).map((r, i) => <li key={r.user.id} className={r.user.id === meId ? 'lb-me' : undefined}>
        <b>{String(i + 4).padStart(2, '0')}</b><span className="lb-avatar" aria-hidden="true">{initials(r.user.displayName)}</span><span className="lb-rowname">{r.user.displayName}{r.user.id === meId && <em> · you</em>}</span><strong>{r.score} pts</strong>
      </li>)}
    </ol>}
    {!rows.length && <p className="empty">No ranked collectors yet. Open a pack to take the first spot.</p>}

    <section className="lb-trending"><h3>Trending cards <span>simulated engagement</span></h3>{trending}</section>
  </div>;
}
