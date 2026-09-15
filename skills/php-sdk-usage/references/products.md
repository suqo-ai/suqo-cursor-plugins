# Products and pagination

Two operations: `list` and `autoPaging`. Signatures in `api-surface.md`.

## One page

```php
$page = $suqo->products->list(page: 1, pageSize: 50);

echo $page->count;                        // total across all pages, not count($page->results)

foreach ($page->results as $product) {
    echo $product->productId, ' ', $product->name, PHP_EOL;

    foreach ($product->plan as $plan) {
        echo '  ', $plan->planId, ' ', $plan->planName, ' ', $plan->billingPeriods, PHP_EOL;
    }
}
```

`page` and `pageSize` are both optional and are dropped from the query string
entirely when null — `pageSize` is sent as `page_size`.

`$page->next` and `$page->previous` are absolute URLs or `null`.

## Every page, lazily

```php
foreach ($suqo->products->autoPaging() as $product) {
    echo $product->name, PHP_EOL;
}
```

A page is fetched only once you have exhausted the previous one, and nothing is
accumulated — so `break` genuinely stops the requests. This is the right default
for a sync job or an export.

Two consequences worth planning around:

- **Errors surface from the `foreach`, not the call.** The generator body does
  not run until first iteration, so wrap the loop, not the assignment.
- **`$page->count` is not available.** Use `list()` when you need the total, or
  count as you go.

```php
try {
    foreach ($suqo->products->autoPaging(pageSize: 100) as $product) {
        $this->upsert($product);
    }
} catch (SuqoError $e) {
    // Partial progress has already happened. Make upsert idempotent.
}
```

Auto-paging is not atomic: the account can change between pages. For a job that
must reconcile, key on `productId` and treat the run as a merge, not a replace.

## Price is not on the product

The product record has no price. Price lives on the plan billing point and
surfaces as `$subscription->product->price` once a subscription exists. If a
developer asks to show a price list from `products->list()`, say that the SDK
cannot supply it and point at the plan/`pbpId` they need instead.

## Where `pbpId` comes from

`create()` needs a `pbpId` — a plan billing point. The product's `plan` array
holds `ProductPlan` records (`planId`, `planName`, `description`,
`billingPeriods`), and `SubscriptionProduct::$pbpId` shows the value an existing
subscription used. Whichever your API contract designates, treat it as an opaque
string and never construct one.

## Record shape

`Product`: `productId`, `name`, `description`, `type`, `isActive` (`?bool`),
`termsAndConditions`, `featuresAndBenefits`, `vat` (decimal **string**),
`productImage`, `plan` (`list<ProductPlan>`), `totalSubscribers` (decimal
**string**), `createdAt`, `updatedAt`. Everything else is `?string`.

`ProductPlan`: `planId`, `planName`, `description`, `billingPeriods` — all
`?string`.

Every property is nullable because reads are tolerant: a field of an unexpected
type reads as absent rather than failing the whole response. Guard with `??` or
`?->` rather than asserting.

## Cancellation in a long read

```php
use Suqo\Cancellation;

$token = new Cancellation();

pcntl_signal(SIGTERM, static fn () => $token->cancel());
pcntl_async_signals(true);

foreach ($suqo->products->autoPaging(cancellation: $token) as $product) {
    $this->upsert($product);
}
```

`CancelledError` is raised at the next page boundary — or mid-flight, or during
retry backoff — and is never retried. It stays distinct from the `NetworkError`
a timeout produces, so "we stopped it" and "the network stopped it" remain
separable in logs.

In a Laravel queue job, trip the token from the job's own timeout handling
rather than a signal handler.

## Following `next` by hand

Rarely needed — `autoPaging()` exists — but if you must page manually, `next` is
already absolute:

```php
$page = $suqo->products->list(pageSize: 50);

while ($page->next !== null) {
    // No public client method takes an absolute URL. Use autoPaging(),
    // or bump `page:` yourself.
    $page = $suqo->products->list(page: ++$n, pageSize: 50);
}
```

`Transport::getAbsolute()` is what auto-paging uses internally; reach for it
only if you are already building a custom resource.
