import { z } from 'zod';
export const MomentTags = z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)).max(40).refine(t => new Set(t).size === t.length, 'Duplicate tags');
export const PromptWeights = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), z.number().finite().min(0).max(1000)).refine(w => Object.keys(w).length > 0);
export function suitability(tags: string[], weights: Record<string, number>) {
 const valid = MomentTags.parse(tags), prompt = PromptWeights.parse(weights);
 const matches = valid.filter(t => (prompt[t] ?? 0)>0).sort().map(tag => ({ tag, points: prompt[tag] }));
 return { score: matches.reduce((n,m) => n+m.points,0), matches };
}
export function greedyCard<T extends {card_id:string;snapshot:{moment_tags:string[]}}>(cards:T[],weights:Record<string,number>):T {
 if(!cards.length) throw new Error('No unused CPU cards');
 return [...cards].sort((a,b)=>suitability(b.snapshot.moment_tags,weights).score-suitability(a.snapshot.moment_tags,weights).score || a.card_id.localeCompare(b.card_id))[0];
}
export function matchOutcome(scores: number[], round: number) {
 const winner=scores.findIndex(s=>s>=3);
 if(winner>=0) return { complete:true,winner:winner+1,draw:false };      // first to 3 clinches the best of five
 if(round<5) return { complete:false,winner:null,draw:false };
 // All five rounds played and nobody clinched: the higher score wins. Only equal scores are a draw.
 return scores[0]===scores[1] ? { complete:true,winner:null,draw:true } : { complete:true,winner:scores[0]>scores[1]?1:2,draw:false };
}
/**
 * Who wins a round. The card that matches the prompt better (higher tag score) wins. If two cards match equally well, the stronger
 * card (higher base power: rarer cards are stronger) wins, so collecting better cards matters. Equal on both: no winner, no point.
 */
export function decideRound(a: {score:number;power:number}, b: {score:number;power:number}): { winner: 1|2|null; tiebreak: boolean } {
 if(a.score!==b.score) return { winner:a.score>b.score?1:2, tiebreak:false };
 if(a.power!==b.power) return { winner:a.power>b.power?1:2, tiebreak:true };
 return { winner:null, tiebreak:false };
}
