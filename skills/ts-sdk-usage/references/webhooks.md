# Webhooks

```ts
suqo.webhooks.verify(options: VerifyWebhookOptions): boolean

interface VerifyWebhookOptions {
  rawBody: string | Buffer;
  signature: string;      // "X-SUQO-Signature" header, e.g. "sha256=<hex>"
  timestamp: string;      // "X-SUQO-Timestamp" header, Unix seconds as a string
  secret: string;
  toleranceSec?: number;  // default 300 (5 minutes)
}
```

`verify()` itself makes no network call, and the API key plays no role in the
verification logic. **But it's still a method on an already-constructed
`SuqoClient`** — `WebhooksResource` isn't exported for standalone
construction (see `api-surface.md`), so reaching `suqo.webhooks.verify(...)`
means building a `SuqoClient` first, which still requires a validly-shaped
`apiKey` (throws `SuqoConfigError` otherwise) even though that key is never
used by verification itself. Don't expect a key-free verification call
without a `SuqoClient` in hand somewhere.

**Never throws** — the source guards `signature`/`timestamp`/`secret`/
`rawBody` all the same way and returns `false` for any of them being
missing or the wrong type, malformed signature, expired timestamp, or an
actual mismatch. Never treat a thrown error as the verification signal;
there isn't one — this includes an absent `secret`, not just a bad
signature.

That said, every template here still checks `process.env.SUQO_WEBHOOK_SECRET`
explicitly and fails closed *before* calling `verify()` at all — not because
`verify()` would misbehave on a missing secret (it wouldn't), but because a
missing-secret `false` and a genuine bad-signature `false` are otherwise
indistinguishable, and a misconfigured deployment deserves a loud, distinct
signal (log + 500) rather than blending into ordinary bad-signature noise.

## The raw-body rule — the single most-broken-handler cause

Verification needs the **exact bytes** the request arrived with, not a
round-tripped re-serialization of the parsed body. A body that's been through
`JSON.parse` then `JSON.stringify` changes whitespace, key order, and number
formatting — enough to break the signature even when every field value
matches.

```ts
// Wrong — passes for a trivial fixture, fails on a real event with nested objects.
suqo.webhooks.verify({ rawBody: JSON.stringify(req.body), /* ... */ });
```

**Express**: if `express.json()` (or any JSON body-parser) already ran on
this route, the raw bytes are gone — the signature will never match. Mount
`express.raw({ type: "application/json" })` on this specific route only, not
globally, so every other route keeps its normal JSON parsing:

```ts
app.post(
  "/webhooks/suqo",
  express.raw({ type: "application/json" }),
  (req, res) => { /* req.body is a Buffer here */ },
);
```

**Next.js (App Router)**: read the raw text yourself in the route handler
before parsing anything —

```ts
export async function POST(req: Request) {
  const rawBody = await req.text();
  // ...
}
```

**Fastify**: there's no drop-in equivalent of `express.raw()` — Fastify's
built-in JSON parser already consumes the body before any handler runs, and
overriding it with `addContentTypeParser()` applies to the whole Fastify
*instance* it's called on. Register the webhook route inside its own plugin
scope so the override only applies there, not app-wide — Fastify's
encapsulation model keeps every other route's normal JSON parsing untouched:

```ts
const webhookRoutes: FastifyPluginAsync = async (instance) => {
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },              // scoped to this plugin instance only
    (_req, body, done) => done(null, body),
  );
  instance.post("/webhooks/suqo", async (request, reply) => { /* request.body is a Buffer here */ });
};

fastify.register(webhookRoutes); // NOT fastify.post(...) directly on the root instance
```

## Signed payload format

```
HMAC-SHA256(key = secret, message = "<timestamp>." + <raw body bytes>)
```

Hex-encoded, sent as `X-SUQO-Signature: sha256=<hex>` alongside
`X-SUQO-Timestamp: <unix seconds>`. The check is `|now - timestamp| >
toleranceSec` — symmetric, so it rejects a timestamp too far in the future
too, not just one that's stale — regardless of whether the signature itself
is valid. Replay protection, not just tamper detection.

## Event payloads stay snake_case — on purpose

Unlike every other model in this SDK, event payload types are **not**
camelCased, because `verify()` never parses the body at all — you call
`JSON.parse(rawBody)` yourself after verifying, and that produces the real
wire keys:

```ts
type WebhookEventType =
  | "checkout.succeeded" | "checkout.failed"
  | "subscription.status_changed"
  | "api_key.created" | "api_key.deleted" | "api_key.expired" | "api_key.expiring_soon";
```

```ts
interface CheckoutSucceededEvent { event: "checkout.succeeded"; subscription_id: string; amount: string; status: "succeeded"; }
interface CheckoutFailedEvent    { event: "checkout.failed";    subscription_id: string; amount: string; status: "failed"; }
interface SubscriptionStatusChangedEvent {
  event: "subscription.status_changed"; subscription_id: string;
  previous_status: SubscriptionStatus; current_status: SubscriptionStatus; changed_at: string;
}

// Every api_key.* event shares these four fields plus its own event name and timestamp field.
// api_key_id is a string on the wire (e.g. "305") — never coerce it, same rule as every other id.
interface ApiKeyCreatedEvent {
  event: "api_key.created"; api_key_id: string; name: string; masked_key: string;
  expires_at: string;  // "YYYY-MM-DD", date-only
  created_at: string;  // ISO 8601
}
interface ApiKeyDeletedEvent {
  event: "api_key.deleted"; api_key_id: string; name: string; masked_key: string;
  expires_at: string; created_at: string; deleted_at: string;  // ISO 8601
}
interface ApiKeyExpiredEvent {
  event: "api_key.expired"; api_key_id: string; name: string; masked_key: string;
  expires_at: string; created_at: string;
}
interface ApiKeyExpiringSoonEvent {
  event: "api_key.expiring_soon"; api_key_id: string; name: string; masked_key: string;
  expires_at: string; created_at: string;
}
```

`amount` stays a string, same decimal rule as everywhere else. `event` is
the discriminant — narrow on it, not on which fields happen to be present.
There is no field literally named `id` on any of these — the identifier is
always `subscription_id` (first three events) or `api_key_id` (last four).

**Dashboard "send test event" payloads nest fields under a `data` key** —
different from the real shapes above. Use test deliveries to confirm your
route is wired up (verification passes, your handler gets called) — not to
validate payload parsing, since the shape genuinely differs from production
events.

## Handler checklist

1. Read the raw body **first** — before any parsing or other middleware
   touches it.
2. Verify. On `false`, return `400` and stop — don't parse, don't log the
   body as trusted, don't process.
3. Parse (`JSON.parse(rawBody)`) only after verifying — in its own
   try/catch. **A verified signature proves the bytes came from SUQO, not
   that they're valid JSON.** If parsing happens after a 2xx has already
   been sent (plain Node, Express, Fastify all send the 2xx before
   parsing — see their templates), a parse failure can only be logged, not
   turned into an error response; on plain `http.ServerResponse` in
   particular, letting it propagate uncaught into a handler that then
   tries to send a second response throws `ERR_HTTP_HEADERS_SENT`, which
   crashes the process on Node's default unhandled-rejection behavior —
   confirmed, not hypothetical. Express/Fastify happen to swallow this
   silently instead of crashing, but silently is still worse than logging
   it. `templates/webhook-nextjs-route.ts` parses *before* responding, so
   it can return a real `400` instead.
4. Return `2xx` fast, then process out of band. A slow handler gets retried
   and duplicated. **On a serverless/edge runtime** (Vercel, Lambda, ...)
   fire-and-forget is unsafe — the function can be frozen the instant the
   response is sent, silently dropping work that wasn't awaited or handed to
   the platform's own keep-alive (`after()`, `waitUntil`). A long-running
   Node/Express process doesn't have this problem. See
   `templates/webhook-nextjs-route.ts` vs `templates/webhook-express.ts`.
5. Be idempotent — key on `api_key_id` (for the `api_key.*` events) or
   `subscription_id` (for `checkout.*`/`subscription.status_changed`) and
   treat a repeat delivery as a no-op. Redelivery is normal; the SDK keeps no
   replay store of its own.
6. Never echo the body back, and never treat a field inside it as an
   authorization decision on its own — verification confirms it came from
   SUQO, not that its contents are safe to act on blindly.

See `templates/webhook-express.ts` and `templates/webhook-nextjs-route.ts`
for full runnable handlers, and `templates/webhook-plain-node.ts` for the
no-framework version.
