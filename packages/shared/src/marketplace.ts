// Shared marketplace response shapes; raw timestamps are ISO strings.
import type { Card } from './index';
export type MarketCard = {
    id: string;
    serial: number;
    card: Card;
};
export type MarketListing = {
    id: string;
    owner_id: string;
    status: 'open' | 'completed' | 'cancelled';
    instance: MarketCard;
    owner: {
        id: string;
        displayName: string;
    };
    created_at: string;
};
export type MarketOffer = {
    id: string;
    listing_id: string;
    owner_id: string;
    bidder_id: string;
    status: 'open' | 'accepted' | 'declined' | 'withdrawn';
    bidder: {
        id: string;
        displayName: string;
    };
    listed: MarketCard;
    offered: MarketCard[];
};
export type MarketNotification = {
    id: string;
    kind: string;
    message: string;
    read_at: string | null;
    created_at: string;
};
