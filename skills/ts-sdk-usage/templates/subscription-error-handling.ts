import {
  AuthenticationError,
  KycRequiredError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "@suqo/sdk";

/**
 * The write error ladder shared by every subscriptions write — create, cancel,
 * updateBillingCycle, resume. Used by both templates/create-subscription.ts
 * and templates/manage-subscription.ts instead of each carrying its own copy,
 * since a real project uses both flows together, not as alternatives — a
 * fix here shouldn't have to be applied twice.
 *
 * `SuqoConfigError` is deliberately NOT special-cased: it's thrown
 * synchronously at `new SuqoClient(...)`, before any request, so it should
 * never actually reach this catch block in practice. Anything unrecognized —
 * that included — is a deploy-time bug, not a request-time error, so it's
 * left to propagate rather than mapped to a response.
 */
export async function handleSubscriptionWrite<T>(
  operation: () => Promise<T>,
  successStatus = 200,
): Promise<{ status: number; body: unknown }> {
  try {
    const body = await operation();
    return { status: successStatus, body };
  } catch (err) {
    if (err instanceof ValidationError) {
      // A genuine problem with THIS request — safe to reflect back.
      // fieldErrors keys are already wire-corrected: "customer.phone", not "client.phone".
      return { status: 422, body: { message: err.message, fieldErrors: err.fieldErrors } };
    }
    if (err instanceof NotFoundError) {
      return { status: 404, body: { message: err.message } };
    }
    if (err instanceof KycRequiredError || err instanceof AuthenticationError) {
      // NOT the caller's fault — this means the merchant's own SUQO account
      // (KYC status, or the API key itself) needs attention. Never leak
      // kycStatus or auth details outward; alert internally instead.
      console.error("SUQO merchant configuration problem:", err);
      return { status: 500, body: { message: "Something went wrong. Please try again later." } };
    }
    if (err instanceof RateLimitError) {
      // Reserved — the live API doesn't emit 429 today, but handle it anyway.
      return { status: 429, body: { message: err.message, retryAfter: err.retryAfter } };
    }
    if (err instanceof ServerError) {
      return { status: 502, body: { message: "SUQO is temporarily unavailable." } };
    }
    if (err instanceof NetworkError) {
      return { status: 504, body: { message: "Could not reach SUQO." } };
    }
    throw err;
  }
}
