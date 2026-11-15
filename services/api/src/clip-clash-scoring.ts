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
 return winner>=0 ? { complete:true,winner:winner+1,draw:false } : {complete:round>=5,winner:null,draw:round>=5};
}
