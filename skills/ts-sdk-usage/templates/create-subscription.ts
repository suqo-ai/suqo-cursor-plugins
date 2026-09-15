import type { CreateSubscriptionResponse, CustomerInput } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js";
import { handleSubscriptionWrite } from "./subscription-error-handling.js";

/**
 * Creates a subscription for a buyer and returns the checkout URL to redirect
 * them to. `checkoutUrl` is NOT proof of payment — the real outcome (paid or
 * failed) arrives later via the checkout.succeeded/checkout.failed webhooks;
 * see templates/webhook-express.ts.
 *
 * If this same buyer already has an inactive/expired subscription for this
 * product+billing-period, SUQO reactivates it instead of creating a new one.
 * A currently-active one throws ValidationError for a duplicate subscription.
 *
 * `customer` takes the SDK's full CustomerInput shape directly (rather than a
 * narrower local type) so billing/shipping overrides stay reachable — see
 * subscriptions.md for the billing_-prefix wire asymmetry on those fields.
 */
export async function createSubscriptionForBuyer(params: {
  pbpId: string;
  returnUrl: string;
  customer: CustomerInput;
}): Promise<CreateSubscriptionResponse> {
  const suqo = getSuqoClient();

  return suqo.subscriptions.create({
    pbpId: params.pbpId,
    returnUrl: params.returnUrl,
    customer: params.customer,
  });
}

/**
 * Wraps createSubscriptionForBuyer with the shared write error ladder (see
 * templates/subscription-error-handling.ts — also used by
 * templates/manage-subscription.ts, so a fix to the ladder only needs to
 * happen once). None of these writes retry automatically, so a NetworkError
 * here means the create may or may not have landed — reconcile with
 * subscriptions.list(), don't just resend.
 */
export async function handleCreateSubscription(req: {
  pbpId: string;
  returnUrl: string;
  customer: CustomerInput;
}): Promise<{ status: number; body: unknown }> {
  return handleSubscriptionWrite(() => createSubscriptionForBuyer(req), 201);
}
