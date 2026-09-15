import type { MessageResponse } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js";
import { handleSubscriptionWrite } from "./subscription-error-handling.js";

/** Schedules cancellation at the end of the current billing period — not immediate. */
export async function cancelSubscription(subscriptionId: string): Promise<MessageResponse> {
  return getSuqoClient().subscriptions.cancel(subscriptionId);
}

/**
 * Collection-level call — subscriptionId travels in the request body, not the
 * URL path, unlike cancel()/resume(). nextBillingCycle must be today-or-future,
 * formatted "YYYY-MM-DD".
 */
export async function updateSubscriptionBillingCycle(
  subscriptionId: string,
  nextBillingCycle: string,
): Promise<MessageResponse> {
  return getSuqoClient().subscriptions.updateBillingCycle({ subscriptionId, nextBillingCycle });
}

/**
 * Un-schedules a pending cancellation / reactivates. Confirmed public and
 * working, but its response shape is "likely-correct-but-unverified" per the
 * SDK's own source comment (built from a Swagger example only) — don't build
 * brittle logic on an exact field of the response here.
 */
export async function resumeSubscription(subscriptionId: string): Promise<MessageResponse> {
  return getSuqoClient().subscriptions.resume(subscriptionId);
}

/**
 * The three functions above are raw — they let a SuqoError subclass
 * propagate uncaught, same as `createSubscriptionForBuyer` does in
 * templates/create-subscription.ts. Wrap them in `handleSubscriptionWrite`
 * (from templates/subscription-error-handling.ts) before exposing them on a
 * route, exactly like that file's own `handleCreateSubscription` does —
 * these three wrappers are the equivalent for cancel/updateBillingCycle/
 * resume. Skipping the wrapper means KycRequiredError/AuthenticationError
 * (merchant-config problems) can reach a buyer-facing response unmapped.
 */
export async function handleCancelSubscription(subscriptionId: string): Promise<{ status: number; body: unknown }> {
  return handleSubscriptionWrite(() => cancelSubscription(subscriptionId));
}

export async function handleUpdateSubscriptionBillingCycle(
  subscriptionId: string,
  nextBillingCycle: string,
): Promise<{ status: number; body: unknown }> {
  return handleSubscriptionWrite(() => updateSubscriptionBillingCycle(subscriptionId, nextBillingCycle));
}

export async function handleResumeSubscription(subscriptionId: string): Promise<{ status: number; body: unknown }> {
  return handleSubscriptionWrite(() => resumeSubscription(subscriptionId));
}
