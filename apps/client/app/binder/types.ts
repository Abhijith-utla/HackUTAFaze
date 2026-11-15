// Shapes returned by GET /binder. Card = shared Card + lore and era.
import type { Card } from '@faze/shared';

export type BinderCardInfo = Card & { lore: string; era: { id: string; name: string } | null };
export type BinderInstance = { id: string; serial: number; acquiredVia: string; tradableAfter: string | null };
export type BinderCard = { card: BinderCardInfo; owned: number; instances: BinderInstance[] };
export type BinderSet = { id: string; name: string; status: string; total: number; owned: number; complete: boolean; cards: BinderCard[] };
export type BinderEra = { id: string; name: string; starts: number | null; ends: number | null; sets: BinderSet[] };
