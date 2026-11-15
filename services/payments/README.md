# services/payments — Agent B (@Abhijith-utla)

Stripe **test mode** coin purchases. Coins are credited only from a signature-verified webhook, via Agent A's `POST /internal/ledger/credit` (idempotency key `purchase:<checkout session id>`).

```
npm run dev -w @faze/payments          # :4100, needs DATABASE_URL, JWT_SECRET, INTERNAL_SECRET
PAYMENTS_STANDALONE=1 npm run dev -w @faze/payments   # no Postgres / API: in-memory purchases + ledger
npm test -w @faze/payments
```

- `STRIPE_MODE=fake` (default): no network, `checkoutUrl` is a local "TEST MODE — simulated payment" page that sends a signed event through the real webhook path.
- `STRIPE_MODE=live`: real Stripe API with `sk_test_…` keys only (boot refuses anything else). Forward webhooks with `stripe listen --forward-to localhost:4100/payments/webhook` and put its `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
