import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuqoClient, ValidationError } from "@suqo/sdk";

/**
 * Stubs the global `fetch` directly — the same pattern the SDK's own test
 * suite uses (test/http/HttpClient.test.ts), not undici's MockAgent.
 *
 * That's not a style preference: `SuqoClientOptions.dispatcher` is real and
 * does get forwarded into every fetch() call, but a MockAgent/MockPool built
 * from a separately npm-installed `undici` package is not guaranteed to be
 * recognized by Node's own *built-in* global fetch when passed as a
 * per-call `dispatcher` — confirmed here to silently fall through to a real
 * network attempt (and hang) on Node 24 rather than intercept, depending on
 * whether the two undici implementations are the same module realm.
 * `setGlobalDispatcher(mockAgent)` (also from `undici`) IS reliably
 * cross-realm-safe if you'd rather mock at that layer — but `vi.stubGlobal`
 * needs no extra dependency at all and is what the SDK's own tests do.
 *
 * Every real layer above the network — the auth header, error mapping,
 * retry policy — still runs; only the raw Response is faked.
 *
 * Never mock SuqoClient or a resource directly — mocking the thing under
 * test tests the mock instead of the integration.
 */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("subscriptions.create", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function suqo(): SuqoClient {
    return new SuqoClient({ apiKey: "su_test_key_abc" });
  }

  it("returns the checkout URL on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          subscription_id: "sub_123",
          pbp_id: "pbp_1",
          status: "pending_checkout",
          checkout_url: "https://checkout.suqo.ai/sub_123",
          next_billing_cycle: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        { status: 201 },
      ),
    );

    const response = await suqo().subscriptions.create({
      pbpId: "pbp_1",
      returnUrl: "https://example.com/return",
      customer: { phone: "9800000000", fullName: "Test Buyer", email: "buyer@example.com", address: "Kathmandu" },
    });

    expect(response.checkoutUrl).toBe("https://checkout.suqo.ai/sub_123");
    // Trailing slash is mandatory on every route (SDK-SPEC.md §3) — asserting
    // it here catches a hand-built URL that quietly drops it.
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("https://test-be.suqo.ai/api/v1/subscriptions/");
  });

  it("maps a field-keyed 400 to ValidationError.fieldErrors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ pbp_id: ["This field is required."] }, { status: 400 }),
    );

    const err = await suqo()
      .subscriptions.create({
        pbpId: "",
        returnUrl: "https://example.com/return",
        customer: { phone: "9800000000", fullName: "Test Buyer", email: "buyer@example.com", address: "Kathmandu" },
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({ pbp_id: ["This field is required."] });
  });
});
