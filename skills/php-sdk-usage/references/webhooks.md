# Webhooks — verification semantics, exactly

## Signature

```php
Suqo\Webhook::verify(
    string $rawBody,
    ?string $signature,
    ?string $timestamp,
    string $secret,
    int $maxAge = Suqo\Constants::WEBHOOK_MAX_AGE,   // 300
): bool
```

`SuqoClient::verifyWebhook()` takes the same five parameters and forwards
unchanged.

Returns `bool`. Throws nothing, ever — including on malformed input, a null
header, a non-numeric timestamp or an empty secret.

## Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `Constants::WEBHOOK_MAX_AGE` | `300` | Default backward tolerance, seconds. Overridable per call. |
| `Constants::WEBHOOK_FORWARD_SKEW` | `60` | Forward tolerance, seconds. **Not** overridable. |

## The signed payload

```
"{timestamp}.{rawBody}"
```

The timestamp string exactly as received — not trimmed, not reformatted, not
re-parsed into a number and back. Likewise the body: re-serialising a parsed
body may coincidentally produce identical bytes for a trivial payload, but any
difference in whitespace, key order, escaping or number formatting breaks the
digest. A literal `.` separator. No length prefix, no
encoding, nothing else concatenated.

HMAC-SHA256 with the secret as the key. The expected value is the lowercase hex
digest; both sides are hex-decoded and compared with `hash_equals`, so the
comparison is on bytes and is constant-time.

## Signature format

`sha256=` followed by exactly 64 hex characters. All three parts are enforced:
the prefix, the length, and hex validity. A signature with the right digest but
no prefix fails. A digest in uppercase hex passes — hex decoding is
case-insensitive.

## The time window

- Too old: `now - timestamp > maxAge` → `false`.
- Too far ahead: `timestamp - now > 60` → `false`, whatever `maxAge` says.

`maxAge` widens only the backward window. That asymmetry is deliberate: a slow
queue or a retry is a backward problem and is yours to size, while a timestamp
from the future means a broken clock and should stay a hard failure.

The timestamp is trimmed before the numeric check, parsed as a float, and must
be finite — so `"1730000000"`, `" 1730000000 "` and `"1730000000.5"` are all
accepted, while `"abc"`, `""`, `"inf"` and `"1e999"` are not.

## What the SDK does not give you

Do not invent any of this — if a task needs it, say it is not in the SDK.

- **No event type enum, no payload schema, no typed event object.** The SDK
  verifies bytes. After verifying, `json_decode` the body yourself and read it
  defensively (`??` on every key). Your API contract, not the SDK, defines the
  event shape.
- **No replay store.** Freshness is a time window, not a nonce cache. Two
  deliveries inside the window both verify, so idempotency is your job — key on
  the event's own id, or on the subscription id plus a state transition.
- **No header name constants.** Read `X-Suqo-Signature` and `X-Suqo-Timestamp`
  from your framework's request object; header lookup is case-insensitive in
  every framework worth using, and `$_SERVER` mangles them to
  `HTTP_X_SUQO_SIGNATURE` / `HTTP_X_SUQO_TIMESTAMP`.
- **No signature generation helper.** For a test fixture, compute it directly:
  `'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret)`.
- **No middleware, route, or framework glue.** See the four
  `templates/webhook-*.php` files.

## Security notes

- Verify before parsing. A verification failure means the bytes are untrusted;
  do not decode them, log them as data, or branch on their content.
- Return `400` on failure, with no body detail. Do not report *which* check
  failed to the caller — that is diagnostic information for your logs only.
- Never compare signatures yourself. `hash_equals` on decoded bytes is what
  makes this constant-time; `===` on hex strings leaks timing.
- The secret belongs in the environment. It is not the API key, and a
  verification-only handler needs no API key at all.
- A verified webhook proves the sender, not the intent. Re-check state against
  your own records before acting on a field in the payload.
