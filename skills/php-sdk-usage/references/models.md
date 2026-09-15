# Response models

Every model extends `Suqo\Model\Model`, has a **private** constructor and a
static `fromWire()`. You never construct one — read what a method returned.

Reads are tolerant: a field of an unexpected type reads as **absent** rather
than failing the whole response. That is why nearly everything is nullable.
Guard with `?->` and `??`; do not assert.

## `toArray()` — the escape hatch

```php
public function toArray(): array
```

The complete decoded payload with **wire names intact**. Available on every
model, page included. Use it for a field the SDK does not type yet:

```php
$checkoutUrl = $created->toArray()['checkout_url'] ?? null;
$subscription->toArray()['client']['email'] ?? null;   // same as ->customer?->email
```

Never parse `toArray()` when a typed property exists — the property is the
supported surface.

## Pages

`Page<T>` — `count` (`int`, total across all pages), `next` (`?string`,
absolute URL), `previous` (`?string`), `results` (`list<T>`). The only model
with a **public** constructor, so it can be built in a test.

`SubscriptionPage extends Page<Subscription>` adds `totalSubscriptions`,
`activeSubscriptions`, `dueSubscriptions`, `inactiveSubscriptions` — each
`?int`, each `null` when the server omits it. Counters accept a JSON number or a
numeric string.

## Records

| Model | Properties |
| --- | --- |
| `Product` | `productId`, `name`, `description`, `type`, `isActive` (`?bool`), `termsAndConditions`, `featuresAndBenefits`, `vat` **str-decimal**, `productImage`, `plan` (`list<ProductPlan>`), `totalSubscribers` **str-decimal**, `createdAt`, `updatedAt` |
| `ProductPlan` | `planId`, `planName`, `description`, `billingPeriods` |
| `Subscription` | `subscriptionId`, `status` (`SubscriptionStatus\|string\|null`), `isActive` (`?bool`), `customer` (`?SubscriptionCustomer`, wire **`client`**), `product` (`?SubscriptionProduct`), `currentPeriodStart`, `currentPeriodEnd`, `nextBillingCycle`, `createdAt` |
| `SubscriptionCustomer` | `phone`, `fullName`, `email`, `address`, `billing` (`?SubscriptionCustomerBilling`), `shipping` (`?SubscriptionCustomerShipping`) |
| `SubscriptionCustomerBilling` | `businessName`, `email`, `address`, `panVat` |
| `SubscriptionCustomerShipping` | `phone`, `fullName`, `email`, `address` |
| `SubscriptionProduct` | `productId`, `name`, `planName`, `pbpId`, `label`, `price` **str-decimal**, `currency` |
| `Customer` | `id` (`?int`), `buyerPhone`, `buyerEmail`, `fullName`, `createdAt` — nothing returns one yet |
| `CreateSubscriptionResponse` | `pbpId`, `returnUrl`, `customer` (`?Params\CustomerInput` — the **write** shape read back) |
| `MessageResponse` | `message` (`string`, non-null, `''` when absent) |

Unless marked otherwise, every property is `?string` and every wire key is the
snake_case form of the name.

## The renames

| Surface | Wire |
| --- | --- |
| `customer` | `client` |
| `KycRequiredError::$kycStatus` | `status_code` |

Nothing else is renamed. Error bodies, `fieldErrors` keys and `toArray()` always
use the wire name.

## The two billing shapes

Billing differs by direction, and the SDK reflects that rather than papering
over it:

| Direction | Type | Property | Wire key |
| --- | --- | --- | --- |
| write | `Params\CustomerBilling` | `billingBusinessName` | `billing_business_name` |
| read | `Model\SubscriptionCustomerBilling` | `businessName` | `business_name` |

You send `billingEmail`, you read `email`. Same for address and PAN/VAT. Do not
write a mapper that assumes symmetry.

## Decimals and dates are strings

`price`, `vat`, `totalSubscribers`, every timestamp and every date. They are
never parsed into a float inside the SDK, and you should not parse them either
unless you need arithmetic:

```php
$total = bcmul($subscription->product->price, '2', 2);      // bcmath
$due   = new DateTimeImmutable($subscription->nextBillingCycle);
```

Casting money to `float` for display is the single most common bug in an
integration. Format the string, or use minor units in an integer.

## `SubscriptionStatus`

Cases: `PendingCheckout` (`pending_checkout`), `Active`, `Due`, `Cancelled`,
`PendingCancellation` (`pending_cancellation`), `Inactive`.

```php
public static function parse(mixed $value): self|string|null
```

A recognised value as a case; an unrecognised one as the raw string; absent or
non-string as `null`. Narrow with `instanceof` before `match` — see
`subscriptions.md`.

## Persisting a record

Store `subscriptionId` (or `productId`) as the key and the status as a string:

```php
$status = $subscription->status;

$row = [
    'subscription_id' => $subscription->subscriptionId,
    'status' => $status instanceof SubscriptionStatus ? $status->value : $status,
    'price' => $subscription->product?->price,        // keep as string / DECIMAL
    'next_billing_cycle' => $subscription->nextBillingCycle,
    'raw' => json_encode($subscription->toArray()),   // cheap future-proofing
];
```

Use `DECIMAL`, not `FLOAT`, for anything monetary.
