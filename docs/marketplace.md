# Public trade marketplace

User-requested extension to the direct-trade contract. Public browsing is at `/trades`, also accessible in the fan app Trades tab. Email/password session authentication is required to list, offer, respond or read private activity. No coin or SOL charge is involved.

Run `npm run migrate --workspace @faze/api` before starting the upgraded server. Migration `004_trade_marketplace.sql` creates market_listings, market_offers and notifications, and adds exclusive marketplace reservation columns to card_instances. Existing direct trades remain valid.

| Method | Route | Request / response |
|---|---|---|
| GET | /marketplace/listings | Public; q (card/member), rarity, page; 25 per page; returns {listings} |
| POST | /marketplace/listings | {instanceId}; returns {listing}, 201 |
| POST | /marketplace/listings/:id/cancel | Owner only; closes competing offers and unlocks copies |
| POST | /marketplace/listings/:id/offers | {instanceIds: UUID[]} (1-20 unique owned copies); returns {offer}, 201 |
| GET | /me/marketplace | Private {incoming,outgoing,listings}; shared MarketOffer/MarketListing shapes |
| POST | /marketplace/offers/:id/accept | Listing owner only; swaps copies atomically |
| POST | /marketplace/offers/:id/decline | Listing owner only |
| POST | /marketplace/offers/:id/withdraw | Bidder only |
| GET | /me/notifications | Private {notifications}, latest 50, persistent unread state |
| POST | /me/notifications/:id/read | Owner only; idempotently marks read |

A listing reserves one copy; an offer reserves the bidder's copies. Multiple bidders can compete for one listing. Accepting under a listing row lock transfers the listed copy to the bidder and the offered copies to the listing owner, closes the listing, declines other offers and unlocks losing bids in the same transaction. Both participants receive durable completion notifications; losing bidders are informed their offer closed. Replays fail without repeating transfer/notification side effects. Cancelling a listing closes all its offers. A card can have only one direct-trade/listing/offer reservation, enforced in SQL and by both trade APIs.

Public responses replace unapproved display names with New collector. No listing descriptions or user messages bypass moderation. The client polls activity and private offers every eight seconds; completion refreshes the collection and displays an in-app toast. No email, browser push permission or external messaging service is required. Notifications are available from the fan header and the standalone market page. Use Refresh to update public browsing; listings also refresh on search/page changes and actions.
