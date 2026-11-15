// Stripe gateway. "live" = real Stripe API in TEST mode; "fake" = local sessions, no network.
// Webhook verification is identical in both modes (Stripe signature scheme), so the fake path
// exercises the same code as the real one.
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { Bundle } from "@faze/shared";
import type { Config } from "./config.js";

export interface CreateSessionInput {
  userId: string;
  bundle: Bundle;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeGateway {
  mode: Config["stripeMode"];
  createSession(input: CreateSessionInput): Promise<{ id: string; url: string }>;
  /** Throws if the signature is invalid. */
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event;
  /** Builds a signature header for a payload (fake mode + tests). */
  sign(payload: string): string;
}

export function makeGateway(cfg: Pick<Config, "stripeMode" | "stripeSecretKey" | "stripeWebhookSecret" | "paymentsUrl">): StripeGateway {
  const stripe = new Stripe(cfg.stripeSecretKey);
  const constructEvent = (raw: Buffer | string, sig: string) =>
    stripe.webhooks.constructEvent(raw, sig, cfg.stripeWebhookSecret);
  const sign = (payload: string) =>
    stripe.webhooks.generateTestHeaderString({ payload, secret: cfg.stripeWebhookSecret });

  if (cfg.stripeMode === "fake") {
    return {
      mode: "fake",
      async createSession() {
        const id = `cs_fake_${randomUUID().replace(/-/g, "")}`;
        return { id, url: `${cfg.paymentsUrl}/payments/fake-checkout/${id}` };
      },
      constructEvent,
      sign,
    };
  }

  return {
    mode: "live",
    async createSession({ userId, bundle, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: userId,
        metadata: { userId, bundleId: bundle.id },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: bundle.priceCents,
              product_data: { name: `${bundle.coins} FaZe coins (TEST MODE — demo only)` },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error("stripe returned a session without a url");
      return { id: session.id, url: session.url };
    },
    constructEvent,
    sign,
  };
}
