# Subscriptions

Five operations: `list`, `autoPaging`, `create`, `cancel`,
`updateBillingCycle`. Signatures in `api-surface.md`.

## The checkout flow

1. Pick a plan billing point (`pbp_…`). It comes from a product's plan — see
   `products.md`.
2. `create()` with the buyer's details and your `returnUrl`.
3. Send the buyer to the checkout URL the server returns, then handle the
   webhook (`references/webhooks.md`) rather than polling.

```php
use Suqo\Params\CreateSubscriptionParams;
use Suqo\Params\CustomerBilling;
use Suqo\Params\CustomerInput;
use Suqo\Params\CustomerShipping;

$created = $suqo->subscriptions->create(new CreateSubscriptionParams(
    pbpId: 'pbp_3n9k2x',
    customer: new CustomerInput(
        phone: '9841000100',
        fullName: 'Ram Shrestha',
        email: 'ram@client.com',
        address: 'Kathmandu, Nepal',
        billing: new CustomerBilling(
            billingBusinessName: 'ABC Pvt Ltd.',
            billingEmail: 'ram@client.com',
            billingAddress: 'Kathmandu, Nepal',
            billingPanVat: '9841000100',
        ),
        shipping: new CustomerShipping(
            phone: '9841000100',
            fullName: 'Ram Shrestha',
            email: 'ram@client.com',
        ),
    ),
    returnUrl: 'https://merchant.example.com/thanks',
));
```

`create()` returns `CreateSubscriptionResponse` with `pbpId`, `returnUrl` and
`customer` — the API declares the 201 body as the same schema as the request, so
it echoes what was sent. **There is no typed `subscriptionId` or checkout URL on
the response.** Anything the server adds beyond the declared schema comes back
through `toArray()`:

```php
$checkoutUrl = $created->toArray()['checkout_url'] ?? null;   // key per your API contract

if ($checkoutUrl === null) {
    // Do not fabricate a URL. Log the raw body and fail loudly.
    throw new RuntimeException('SUQO create returned no checkout URL: '
        . json_encode($created->toArray()));
}
```

`$created->customer` is `Params\CustomerInput` — the write shape read back, not
the embedded read shape a subscription record carries.

## Wire names when a create fails

`ValidationError::$fieldErrors` is keyed by **wire** name. Map before showing
anything to a user:

| Wire key in the error | What you passed |
| --- | --- |
| `pbp_id` | `pbpId` |
| `client` | `customer` |
| `client.full_name` | `customer->fullName` |
| `client.billing.billing_email` | `customer->billing->billingEmail` |
| `return_url` | `returnUrl` |

Inspect the exact body you are about to send, without a request:

```php
echo json_encode($params->toWire(), JSON_PRETTY_PRINT);
```

## The error ladder for a create

```php
use Suqo\Exception\KycRequiredError;
use Suqo\Exception\SuqoError;
use Suqo\Exception\ValidationError;

try {
    $created = $suqo->subscriptions->create($params);
} catch (ValidationError $e) {
    foreach ($e->fieldErrors as $field => $messages) {
        // $field is a wire name
        $errors[$field] = $messages;
    }
} catch (KycRequiredError $e) {
    // Merchant onboarding incomplete — not the buyer's fault.
    // $e->kycStatus is the wire `status_code`.
} catch (SuqoError $e) {
    error_log("suqo {$e->status} req={$e->requestId}: {$e->getMessage()}");
}
```

**Writes are not retried.** A `NetworkError` from `create()` means the
subscription may or may not have been created. Do not resend blindly: record
your own idempotency marker before the call, and reconcile against
`subscriptions->list()` afterwards.

## Listing

```php
$page = $suqo->subscriptions->list(pageSize: 50);

echo $page->totalSubscriptions, ' / ', $page->activeSubscriptions, PHP_EOL;

foreach ($page->results as $subscription) {
    echo $subscription->subscriptionId, ' ', $subscription->customer?->email, PHP_EOL;
    echo '  ', $subscription->product?->price, ' ', $subscription->product?->currency, PHP_EOL;
    echo '  next billing ', $subscription->nextBillingCycle, PHP_EOL;
}
```

`SubscriptionPage` adds four `?int` counters: `totalSubscriptions`,
`activeSubscriptions`, `dueSubscriptions`, `inactiveSubscriptions`. They live on
the page, so **`autoPaging()` cannot see them** — call `list()` when you need a
dashboard total.

There is no server-side filter or search parameter, and no single-subscription
read. To find one subscription, iterate:

```php
foreach ($suqo->subscriptions->autoPaging(pageSize: 100) as $subscription) {
    if ($subscription->subscriptionId === $id) {
        return $subscription;
    }
}
```

That is O(n) over the account. For anything hot, persist the records you care
about locally and keep them fresh from webhooks — do not put a full scan in a
request path.

## Status

```php
use Suqo\Model\SubscriptionStatus;

$status = $subscription->status;   // SubscriptionStatus|string|null

if ($status instanceof SubscriptionStatus) {
    match ($status) {
        SubscriptionStatus::Active              => $this->activate($subscription),
        SubscriptionStatus::Due                 => $this->chase($subscription),
        SubscriptionStatus::PendingCheckout     => null,
        SubscriptionStatus::PendingCancellation => $this->windDown($subscription),
        SubscriptionStatus::Cancelled,
        SubscriptionStatus::Inactive            => $this->deactivate($subscription),
    };
} else {
    // A status added server-side, or absent. Log; do not throw.
    error_log('unrecognised SUQO status: ' . var_export($status, true));
}
```

Always narrow with `instanceof` first. A bare `match ($subscription->status)`
will throw `\UnhandledMatchError` the first time the API adds a status.

`isActive` is a separate `?bool` and is the cheaper check when all you need is a
gate.

## Cancelling

```php
$result = $suqo->subscriptions->cancel('3fa85f64-5717-4562-b3fc-2c963f66afa6');

echo $result->message;
```

No request body is sent and no `Content-Type` header is set. A 404 means the id
is unknown to **this environment** — a live id against a test key looks exactly
like a missing one.

There is no `resume()`. Do not offer an "undo cancel" flow through this SDK.

## Moving the billing cycle

```php
use Suqo\Params\UpdateBillingCycleParams;

$suqo->subscriptions->updateBillingCycle(new UpdateBillingCycleParams(
    subscriptionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    nextBillingCycle: '2026-09-03',        // YYYY-MM-DD, a string
));
```

The id travels in the body, not the path. `nextBillingCycle` stays a string —
format a `DateTimeInterface` yourself:

```php
nextBillingCycle: $date->format('Y-m-d'),
```

## Sending a field the SDK does not type

Every params object takes `extra`, merged into the body verbatim under wire
names. A declared key always wins over an `extra` key of the same name.

```php
new UpdateBillingCycleParams(
    subscriptionId: $id,
    nextBillingCycle: '2026-09-03',
    extra: ['reason' => 'customer request'],
);
```

## Record shape

`Subscription`: `subscriptionId`, `status`, `isActive` (`?bool`), `customer`
(`?SubscriptionCustomer`, wire `client`), `product` (`?SubscriptionProduct`),
`currentPeriodStart`, `currentPeriodEnd`, `nextBillingCycle`, `createdAt`.

`SubscriptionProduct`: `productId`, `name`, `planName`, `pbpId`, `label`,
`price` (decimal **string**), `currency`.

`SubscriptionCustomer`: `phone`, `fullName`, `email`, `address`, `billing`,
`shipping`. The read shape drops the `billing_` prefix the write shape carries —
you send `billingBusinessName`, you read `businessName`.

Full property tables in `models.md`.
