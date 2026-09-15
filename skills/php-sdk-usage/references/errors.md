# Errors, retries and surfacing failures

Hierarchy and fields in `api-surface.md`. This file is about what to *do* with
each one.

## The five fields on every error

```php
catch (SuqoError $e) {
    $e->status;       // int  — HTTP status, or 0 for a non-HTTP failure
    $e->requestId;    // string — X-Request-Id actually sent on the failing attempt
    $e->rawBody;      // mixed — parsed body, wire names preserved, null if none/unparseable
    $e->fieldErrors;  // array<string, list<string>> — always present, usually empty
    $e->retryAfter;   // ?float — seconds, from Retry-After
}
```

Always log `requestId` — it is what support will ask for. Each retry attempt
carries a **new** id, so log the one on the error, not one from an earlier line.

## Mapping onto an HTTP response

A handler that covers everything, ordered specific → general:

```php
use Suqo\Exception\AuthenticationError;
use Suqo\Exception\CancelledError;
use Suqo\Exception\KycRequiredError;
use Suqo\Exception\NetworkError;
use Suqo\Exception\NotFoundError;
use Suqo\Exception\RateLimitError;
use Suqo\Exception\ServerError;
use Suqo\Exception\SuqoError;
use Suqo\Exception\ValidationError;

try {
    $result = $action();
} catch (ValidationError $e) {
    return $this->unprocessable($e->fieldErrors);            // 422 to your client
} catch (NotFoundError $e) {
    return $this->notFound();                                // 404
} catch (KycRequiredError $e) {
    // Merchant onboarding, not the buyer's problem.
    $this->alertOps('SUQO KYC required: ' . $e->kycStatus);
    return $this->serviceUnavailable();                      // 503
} catch (AuthenticationError $e) {
    // Our credentials, not the caller's. Never leak this outward.
    $this->alertOps('SUQO auth failed req=' . $e->requestId);
    return $this->serverError();                             // 500
} catch (RateLimitError $e) {
    return $this->tooManyRequests($e->retryAfter);           // 429, pass Retry-After on
} catch (NetworkError | ServerError $e) {
    return $this->badGateway();                              // 502
} catch (CancelledError $e) {
    return $this->clientClosedRequest();                     // 499 / no response
} catch (SuqoError $e) {
    error_log("suqo {$e->status} req={$e->requestId}: {$e->getMessage()}");
    return $this->serverError();                             // 500
}
```

Never return `$e->getMessage()` or `$e->rawBody` straight to an end user. Both
can carry upstream detail — merchant identifiers, KYC state, internal field
names.

## Startup vs runtime

`SuqoConfigError extends \InvalidArgumentException`, so a
`catch (SuqoError)` will **not** catch it. It is a deployment mistake, not an
API outcome, and there is no `status` or `requestId` because no request exists.

```php
} catch (SuqoConfigError | SuqoError $e) {
    // Only when one handler genuinely must cover both.
}
```

Prefer catching it once at boot (see `client-setup.md`) and letting runtime code
assume a valid client.

## `ValidationError` — the only one with field errors

```php
} catch (ValidationError $e) {
    $emailProblems = $e->fieldErrors['email'] ?? [];
}
```

Keys are **wire** names (`pbp_id`, `client`, `billing_email`) because the body is
reported as it arrived. Map them onto your form fields explicitly; do not show
raw keys to a user. `getMessage()` is the first message in the body's own key
order.

`fieldErrors` is populated **only** on a 400 with a field-shaped body. A 400
whose body is `{"detail": "…"}` gives an empty `fieldErrors` and that string as
the message.

## `KycRequiredError` — and the 403 that is not one

`kycStatus` is the wire field `status_code`, renamed because it sits next to the
HTTP status and means something else. The raw body still says `status_code`.

A 403 whose body is **not** KYC-shaped (both `status_code` and `message`,
both strings) yields a bare `SuqoError` with the message
`Unexpected status 403.` — so if you are catching only `KycRequiredError` and
seeing nothing, that is why. Catch `SuqoError` too.

## `RateLimitError`

Already retried automatically on a `GET`, honouring a numeric `Retry-After`
capped at 60 s. If it still surfaces, retries are exhausted. On a write it is
never retried at all — back off using `$e->retryAfter` when non-null, else your
own policy.

Do not add your own retry loop around a `GET`; you will be nesting two
backoffs. Raise `maxRetries` instead.

## `NetworkError` on a write is ambiguous

Writes are not retried, pending idempotency keys. A `NetworkError` from
`create()`, `cancel()` or `updateBillingCycle()` means the request may or may
not have landed.

Do not resend blindly. Either:

- record your own marker before the call and reconcile against
  `subscriptions->list()` after; or
- surface it as "we could not confirm" and let a human or a scheduled
  reconciliation resolve it.

## `CancelledError` is yours, not the network's

Raised only because a `Cancellation` token was tripped. Never retried, and
deliberately distinct from the `NetworkError` a timeout produces. Treat it as
"we stopped" — not a failure to alert on.

## `NotImplementedError`

Every `$suqo->customers` method. `status` is `0`, nothing was sent. If a task
needs customer data, say the SDK does not expose it rather than working around
it — see the customers section of `api-surface.md`.

## Retry rules, stated once

Retried when **both** hold:

1. the method is `GET`; and
2. `status` is `0`, `429`, or `>= 500`.

`CancelledError` is excluded unconditionally. Backoff is full jitter — a uniform
draw across `[0, cap)` with `cap = min(8000, 500 * 2 ** attempt)` ms — and a
numeric `Retry-After` wins, capped at 60 s. A `Retry-After` that is an HTTP-date
is ignored.

So `maxRetries: 2` (the default) means up to three attempts and up to ~9 s of
added latency on top of three timeouts. Size `timeout` accordingly in a request
path.

## Debugging checklist

| Symptom | First thing to check |
| --- | --- |
| `SuqoConfigError` at boot | Key present? Correct prefix? `environment:` argument agreeing? |
| `AuthenticationError` | Right key for the right environment — `$suqo->config->environment->value`. |
| `NotFoundError` on a known id | Live id against a test key, or the reverse. |
| `ValidationError` on a wire key you do not recognise | `echo json_encode($params->toWire(), JSON_PRETTY_PRINT);` |
| Field missing from a model | `$model->toArray()` — it may exist untyped. |
| `\UnhandledMatchError` on status | Narrow with `instanceof SubscriptionStatus` first. |
| Slow request path | `timeout` is per attempt and multiplies by retries. |
| Nothing in logs | `logLevel: 'debug'`; output goes to `STDERR`. |
