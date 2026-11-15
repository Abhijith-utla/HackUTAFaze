'use client';
import type { ReactNode } from 'react';
import type { LeaderboardResponse } from '@faze/shared';
import './leaderboard.css';

const MEDAL = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' } as const;
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Top collectors: a stepped podium, the top-3 merch prize with the viewer's progress toward it, and score-bar rows with the prize cutoff marked. */
export default function LeaderboardTab({ board, meId, trending }: { board: LeaderboardResponse; meId: string; trending: ReactNode }) {
  const rows = board.collectors;
  const top = rows[0]?.score || 1;
  const cutoff = rows[2]?.score;                       // score of 3rd place = the prize line
  const mine = rows.findIndex(r => r.user.id === meId);
  const mineScore = mine >= 0 ? rows[mine].score : 0;
  const gap = mine > 2 && cutoff !== undefined ? cutoff - mineScore + 1 : 0;
  const progress = mine > 2 && cutoff ? Math.min(100, Math.round((mineScore / cutoff) * 100)) : 100;
  const podium = [2, 1, 3] as const;                   // visual order: silver, gold, bronze

  return <div className="lb">
    <ol className="lb-podium" aria-label="Top three collectors">
      {podium.map(place => {
        const row = rows[place - 1];
        return <li key={place} className={`lb-pod lb-pod-${place}${row?.user.id === meId ? ' lb-me' : ''}`}>
          <span className="lb-medal">{MEDAL[place]}</span>
          <span className="lb-avatar" aria-hidden="true">{row ? initials(row.user.displayName) : '–'}</span>
          <strong className="lb-name">{row ? row.user.displayName : 'Open spot'}</strong>
          <span className="lb-pts"><b>{row ? row.score : '—'}</b> pts</span>
          <span className="lb-step" aria-hidden="true">{place}</span>
        </li>;
      })}
    </ol>

    <div className="lb-main">
      <div className="lb-list">
        <div className="lb-list-head"><span>Chasing the podium</span>{cutoff !== undefined && <span>Prize line · {cutoff} pts</span>}</div>
        {rows.length > 3 ? <ol className="lb-rows" start={4}>
          {rows.slice(3).map((r, i) => {
            const toGo = cutoff !== undefined ? cutoff - r.score + 1 : 0;
            return <li key={r.user.id} className={r.user.id === meId ? 'lb-me' : undefined}>
              <b>{String(i + 4).padStart(2, '0')}</b>
              <span className="lb-avatar" aria-hidden="true">{initials(r.user.displayName)}</span>
              <span className="lb-rowmain">
                <span className="lb-rowname">{r.user.displayName}{r.user.id === meId && <em>you</em>}</span>
                <span className="lb-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (r.score / top) * 100)}%` }} />{cutoff !== undefined && <u style={{ left: `${(cutoff / top) * 100}%` }} />}</span>
              </span>
              <span className="lb-rowpts"><strong>{r.score} pts</strong><small>{toGo > 0 ? `${toGo} to prize` : ''}</small></span>
            </li>;
          })}
        </ol> : <p className="lb-empty">Nobody is chasing the podium yet. Open a pack and take a spot.</p>}
      </div>

      <aside className="lb-side">
        <section className="lb-prize" aria-label="Top three prize">
          <img src="/prizes/hoodie.webp" alt="FaZe Clan × A Bathing Ape red camo hoodie" width={200} height={250} />
          <p className="lb-eyebrow">Top 3 prize</p>
          <h3>FaZe Clan × BAPE camo hoodie</h3>
          <p className="lb-prize-copy">The three highest-scoring collectors each win one.</p>
          <span className="lb-demo">Demo prize</span>
        </section>

        <section className={`lb-standing${mine >= 0 && mine < 3 ? ' lb-in' : ''}`} aria-label="Your standing" role="status">
          {mine < 0 ? <><p className="lb-eyebrow">Your standing</p><p>You are not in the top {rows.length} yet. Open packs and trade up to climb.</p></>
            : mine < 3 ? <><p className="lb-eyebrow">Your standing</p><p className="lb-big">#{mine + 1} <span>{mineScore} pts</span></p><p>You are in prize position. Hold it.</p></>
            : <><p className="lb-eyebrow">Your standing</p><p className="lb-big">#{mine + 1} <span>{mineScore} pts</span></p>
              <div className="lb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Progress to the prize line"><i style={{ width: `${progress}%` }} /></div>
              <p><b>{gap} more {gap === 1 ? 'point' : 'points'}</b> puts you in the top 3.</p></>}
        </section>
      </aside>
    </div>

    <section className="lb-trending"><h3>Trending cards <span>simulated engagement</span></h3>{trending}</section>
  </div>;
}
