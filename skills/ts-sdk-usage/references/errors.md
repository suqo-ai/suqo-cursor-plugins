# Errors

```
Error
└── SuqoError                 status?, rawBody?, requestId?   — never thrown directly itself
    ├── SuqoConfigError       bad key/baseUrl at construction — thrown synchronously, before
    │                         any request; never carries status/rawBody (there was no request)
    ├── AuthenticationError   401
    ├── KycRequiredError      403 — adds kycStatus?: string (wire status_code)
    ├── ValidationError       400 — adds fieldErrors: FieldErrors (Record<string, string[]>)
    ├── NotFoundError         404
    ├── RateLimitError        429 — adds retryAfter?: number (ms) — reserved, never thrown today
    ├── ServerError           5xx, and the default for any unmapped status
    └── NetworkError          no HTTP status at all — network failure, timeout, or cancellation
```

**`SuqoConfigError` extends `SuqoError`** — `catch (err) { if (err instanceof
SuqoError) ... }` catches it too. Every error this SDK throws is a
`SuqoError`; the base class itself is just never thrown directly.

`requestId` is declared on the base class and threaded through
`mapHttpError`'s input type, but nothing in the real HTTP layer currently
extracts one from a response header or body field — it's `undefined` on
every error the SDK throws today. Don't build error-correlation/alerting
logic keyed on it yet; the SDK's own source flags it as a pending
nice-to-have, not a currently-working field.

`NetworkError` carries no `status` — it's thrown directly by the HTTP layer
itself (a `fetch` rejection or an `AbortSignal.timeout` firing), never via
`mapHttpError`, since there was never a response to map. It covers both a
genuine network failure and a timeout — there's no separate timeout class.

Check `instanceof`, never the error's `message` string or the raw response
shape — those carry no stability guarantee.

## `SuqoConfigError` — thrown at construction, not at request time

Thrown synchronously from `new SuqoClient(...)`, before any request — bad API
key format, or a `baseUrl` that disagrees with the key's inferred
environment (see `client-setup.md`). Since it's still a `SuqoError`, a broad
`instanceof SuqoError` catch does cover it — the only reason to ever branch
on it specifically is that it means "fix the deployment," not "handle this
one request differently."

## `ValidationError` normalizes two wire shapes into one

```ts
interface FieldErrors { [field: string]: string[]; }

class ValidationError extends SuqoError {
  readonly fieldErrors: FieldErrors;   // always a plain object, never undefined
}
```

The wire sends one of two 400 shapes:

- **Field-keyed**: `{ "phone": ["This field is required."] }` → populates
  `fieldErrors`. Nested objects are flattened to dot-path keys
  (`customer.phone`) — and that root key is already renamed from the wire's
  `client` to `customer`, same rename as everywhere else in this SDK.
- **`detail`-shaped**: `{ "detail": "..." }` → populates only `message`;
  `fieldErrors` stays `{}`.

## `KycRequiredError`

403 with a KYC-shaped body (`{ "status_code": "<kyc status>", "message":
"..." }`). `kycStatus` is read from that `status_code`.

## `AuthenticationError` and `KycRequiredError` are merchant-config problems, not buyer input problems

Both mean something is wrong with *your own* SUQO setup — the merchant's API
key is invalid/revoked, or the merchant's own KYC isn't complete — never
something the end buyer did. In an API route that ends up returning a
response to a buyer's browser, don't map these straight to a 401/403 sent to
the buyer, and don't leak `kycStatus` into that response: it describes your
account's standing, not theirs. Log it loudly for your own alerting instead,
and return a generic 5xx to the caller — the same distinction PHP's skill
draws for the identical error classes. `ValidationError`/`NotFoundError` are
the ones that are genuinely about the specific request and are safe to
reflect back.

## `RateLimitError` — reserved, not live yet

429 with `retryAfter?: number` (milliseconds, parsed from a `Retry-After`
header in either delta-seconds or HTTP-date form, clamped to a 60s max). The
live API doesn't emit 429 today — this class exists so the type is already
in place once rate limiting ships. See the SDK's own
`docs/user/rate-limiting.md`, explicitly marked "Status: Planned."

## Retries — the headline rule

**Reads** (`list`, `autoPaging`) retry on `NetworkError`, `429`, and `5xx`,
with full-jitter exponential backoff (base 500ms, capped at 8s,
`Math.random() * min(cap, base * 2^attempt)`), up to `maxRetries` (default 2
→ 3 attempts total), honoring a `Retry-After` header when present.

**Writes** (`create`, `cancel`, `updateBillingCycle`, `resume`) **never
retry**, regardless of `maxRetries`. There's no idempotency-key support on
the backend yet (`docs/user/idempotency.md`, also "Status: Planned") — a
blindly-retried write could double-act, e.g. create a duplicate subscription.
A `NetworkError` from a write means it may or may not have landed; reconcile
by re-listing, don't just resend the same call.

Internally, a caller-supplied `AbortSignal` is never retried either, even on
an otherwise-retryable read — but this is describing the internal HTTP
layer's own behavior, not a publicly reachable option: no public resource
method (`list`, `create`, etc.) actually accepts a `signal`. See
`pagination.md` for what that means in practice — there's currently no
supported way to cancel an in-flight call from application code.

## `mapHttpError`

```ts
function mapHttpError(input: { status: number; statusText?: string; body?: unknown; requestId?: string; retryAfter?: number }): SuqoError
```

The single centralized status→class mapper every resource routes through.
Exported for anyone building a custom transport around the same rules — see
`api-surface.md`.
