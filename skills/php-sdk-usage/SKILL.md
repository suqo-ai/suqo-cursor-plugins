---
name: php-sdk-usage
description: >-
  Use for any PHP work with the SUQO PHP SDK (suqo/suqo-php, namespace Suqo\) —
  listing products, creating or cancelling subscriptions, moving a billing
  cycle, paging, verifying inbound webhooks, wiring the client into Laravel,
  Symfony, Slim or plain PHP, reading SUQO error responses, or testing code that
  calls the SDK. Provides exact method signatures so the SDK is never guessed
  at, and the raw-body rule that most broken webhook handlers get wrong.
---

# SUQO PHP SDK — usage

`suqo/suqo-php`, namespace `Suqo\`, PHP 8.1+, extensions `curl`, `json`, `hash`.
No runtime Composer dependencies.

```bash
composer require suqo/suqo-php
```

## Workflow

1. **Name the task** — checkout flow, subscription dashboard, webhook endpoint,
   cancellation route, sync job.
2. **Load only the reference you need** from `references/`. Never load them all.
   `references/api-surface.md` is the authority on signatures; load it before
   writing any SDK call.
3. **Start from a template** in `templates/` when one is close, rather than
   writing from scratch.
4. **Write against documented methods only.** If a reference does not cover
   something, say so — do not invent a method, parameter or property. The
   surface is small and closed: nine callable operations, three of which throw.
5. **Verify** — `php -l` every file written, then run the project's own test or
   lint command. If the project has a sandbox key available, exercise the code
   for real; otherwise say plainly that it was not run against the API.

## The whole callable surface

| Call | Returns |
| --- | --- |
| `new SuqoClient(...)` | `SuqoClient` |
| `$suqo->products->list(page:, pageSize:, cancellation:)` | `Page<Product>` |
| `$suqo->products->autoPaging(...)` | `Generator<int, Product>` |
| `$suqo->subscriptions->list(...)` | `SubscriptionPage` |
| `$suqo->subscriptions->autoPaging(...)` | `Generator<int, Subscription>` |
| `$suqo->subscriptions->create(CreateSubscriptionParams, cancellation:)` | `CreateSubscriptionResponse` |
| `$suqo->subscriptions->cancel(string $id, cancellation:)` | `MessageResponse` |
| `$suqo->subscriptions->updateBillingCycle(UpdateBillingCycleParams, cancellation:)` | `MessageResponse` |
| `Webhook::verify(...)` / `SuqoClient::verifyWebhook(...)` | `bool` |
| `$suqo->customers->list()` / `->autoPaging()` / `->read($id)` | **throws `NotImplementedError`** |

There is no `subscriptions->retrieve()`, no `resume()`, and no working customers
resource. Those operations exist in the API but are deliberately not exposed;
never write a call to them.

## Rules that trip people up

Apply these without being asked — most bug reports against this SDK are one of them.

- **Money and dates are strings.** `price`, `vat`, `totalSubscribers`, every
  timestamp. Never cast to `float`; use `bcmath` or an integer-minor-unit type.
- **The SDK says `customer`, the wire says `client`.** You write
  `customer:`, error bodies and `toArray()` say `client`. A `ValidationError`
  naming `client.email` means your `CustomerInput` email.
- **Webhook verification needs the raw bytes.** The signature covers bytes, not
  structure. See the webhooks section below — this is the single most common
  broken handler.
- **Environment comes from the key prefix.** `su_test_key_` is sandbox,
  `su_key_` is live. Passing `environment:` is a *check* that can only agree or
  throw `SuqoConfigError` — it is not a switch.
- **`SuqoConfigError` is not a `SuqoError`.** It extends
  `\InvalidArgumentException` and is raised at construction. A single handler
  covering startup and runtime must catch both.
- **Writes are never retried.** `GET` retries up to `maxRetries` on 0/429/5xx; a
  `NetworkError` from `create()` means the subscription may or may not exist.
  Reconcile, do not blindly resend.
- **Everything optional is a named argument.** Never pass positionally past the
  first parameter; the SDK adds options by name.
- **Unknown fields are reachable.** `$model->toArray()` returns the decoded
  payload with wire names, so a field the SDK does not type yet needs no upgrade.
- **`SubscriptionStatus` may be a raw string.** Narrow with `instanceof` before
  matching, or a status added server-side will fall through your `match`.

## Webhooks

`Suqo\Webhook::verify()` is standalone: no client, no API key, no network. Safe
in a serverless handler. It **never throws** — every failure path, malformed
input included, returns `false`.

```php
use Suqo\Webhook;

$verified = Webhook::verify(
    rawBody: $raw,                                       // the exact bytes received
    signature: $_SERVER['HTTP_X_SUQO_SIGNATURE'] ?? null,
    timestamp: $_SERVER['HTTP_X_SUQO_TIMESTAMP'] ?? null,
    secret: (string) getenv('SUQO_WEBHOOK_SECRET'),
    maxAge: 300,                                         // optional; seconds, backward only
);
```

`SuqoClient::verifyWebhook()` is an identical static alias, for a handler that
already imports the client. Prefer `Webhook::verify()` — one small class.

### Pass the raw bytes

A body re-serialised from a parse verifies only by luck: a round-trip through a
JSON decoder changes whitespace, key order, escaping and number formatting. A
trivial payload may survive it and pass locally, then fail the moment a real
event carries nested objects or unicode.

```php
// Wrong — passes for a trivial fixture, fails on real events.
Webhook::verify(rawBody: json_encode($request->all()), /* … */);

// Right, per framework:
$raw = file_get_contents('php://input');    // plain PHP
$raw = $request->getContent();              // Laravel, Symfony
$raw = (string) $request->getBody();        // PSR-7 (rewind first if already read)
```

If middleware has already consumed the input stream, capture the bytes before it
runs. In Laravel that means keeping the webhook route out of middleware that
touches the body, and excluding it from CSRF.

### Handler checklist

1. Read the raw body **first**, before any parsing or middleware.
2. Verify, and on `false` return `400` and stop. Do not parse, do not log the
   body as trusted, do not process.
3. Parse only after verifying.
4. Return `2xx` fast, then process out of band. Slow handlers get retried and
   duplicated.
5. Be idempotent — key on the event's own id or the subscription id and treat a
   repeat as a no-op. Redelivery is normal, and the SDK keeps no replay store.
6. Never echo the body back, and never trust a field in it as an authorisation
   decision on its own.

Exact check order, the signed-payload format, the fixed 60 s forward skew and a
`false`-diagnosis table are in `references/webhooks.md`.

## Reference index

| Reference | Load when |
| --- | --- |
| `references/api-surface.md` | Writing any SDK call — exact signatures, returns, throws. Load first. |
| `references/client-setup.md` | Constructing the client, env vars, timeouts, DI in Laravel/Symfony/Slim, injecting an HTTP client. |
| `references/subscriptions.md` | Create, cancel, billing-cycle flows; params objects and their wire keys. |
| `references/products.md` | Listing products and plans, pagination, auto-paging, cancellation tokens. |
| `references/webhooks.md` | Verification semantics, edge cases, diagnosing a `false`, what the SDK does not provide. |
| `references/errors.md` | Mapping SUQO failures onto HTTP responses, field errors, KYC, retries. |
| `references/models.md` | Property names and types on every response record. |

## Templates index

| Template | Use for |
| --- | --- |
| `templates/suqo-client.php` | One factory that reads config from the environment. |
| `templates/list-products.php` | Auto-paging read with a cancellation token. |
| `templates/create-subscription.php` | Full nested create with the error ladder. |
| `templates/laravel-service-provider.php` | Binding `SuqoClient` as a Laravel singleton. |
| `templates/webhook-plain-php.php` | Single-file webhook endpoint, no framework. |
| `templates/webhook-laravel-controller.php` | Controller, route and CSRF exclusion. |
| `templates/webhook-symfony-controller.php` | Symfony controller with attribute routing. |
| `templates/webhook-psr15-middleware.php` | PSR-15 middleware for Slim, Mezzio or similar. |

## Testing SDK code

The only seam is `httpClient:` — `HttpClientInterface` has one method, so a fake
is a dozen lines, and every layer above it (headers, serialisation, error
mapping, retries, pagination) still runs for real.

```php
$suqo = new SuqoClient(apiKey: 'su_test_key_abc', httpClient: $fake);
```

Never mock `SuqoClient`, a resource, or a model: the client is `final`, models
have private constructors, and mocking them tests the mock instead of the
integration. A fake must return an `HttpResponse` for **every** status (4xx and
5xx included — the transport maps statuses) and may throw only
`HttpCancelledException` (→ `CancelledError`) or `HttpClientException`
(→ `NetworkError`). Queue one response per **attempt**, not per call, or pass
`maxRetries: 0`.

Fixtures are **wire**-shaped: `product_id`, `client`, `billing_business_name`.
Build records with `Product::fromWire([...])`; `Page` has a public constructor,
records do not. For a request-body assertion, skip the transport entirely —
`$params->toWire()` is public.
