# Models — property reference

Property names and types on every response/params record. For the handful of
fields where the SDK name differs from the wire, both are given; everywhere
else, assume plain camelCase of the wire's snake_case (`product_id` →
`productId`) and it's correct.

## Renames — the short, complete list

| Wire | SDK | Why |
| --- | --- | --- |
| `client` (top-level, on create/read) | `customer` | Collides with the SDK's own client object. **Only the root key** — nested fields under it keep their own wire-derived names (see the billing/shipping asymmetry in `subscriptions.md`). |
| `Message` (schema name) | `MessageResponse` | Collides with `SuqoError.message`. |
| `*Request` (schema names, e.g. `CreateSubscriptionRequest`) | `*Params` (`CreateSubscriptionParams`) | "Request" reads as an HTTP request object, which it isn't. |
| `PaginationEnvelope` (schema name) | `Page` | Shorter, and matches what every list call actually returns. |

These four are the complete registered rename list (per the SDK's own
`src/models/index.ts`) — everything below this line is plain camelCase, no
further renames.

## `Product` / `Plan` / `BillingPeriod`

```ts
interface ProductVat { isVatActive: boolean; vatType: string; vatPercentage: string; }
interface BillingPeriod {
  pbpId: string; intervalType: string; intervalCount: number; label: string;
  price: string; currency: string; isCurrent: boolean; isLimited: boolean;
  isArchived: boolean; offers: unknown[];
}
interface Plan { planId: string; planName: string; description: string; billingPeriods: BillingPeriod[]; }
interface Product {
  productId: string; name: string; description: string; type: string; isActive: boolean;
  termsAndConditions: string; featuresAndBenefits: string; vat: ProductVat | null;
  productImage: string[]; plan: Plan[]; totalSubscribers: string;
  createdAt: string; updatedAt: string;
}
```

`price`, `vatPercentage`, `totalSubscribers` — strings, never coerced.

## `Subscription` and its nested types

```ts
interface SubscriptionProduct {
  productId: string; name: string; planName: string; pbpId: string; label: string;
  price: string; currency: string;
}
interface SubscriptionCustomerBilling { businessName?: string; email?: string; address?: string; panVat?: string; }
interface SubscriptionCustomerShipping { phone?: string; fullName?: string; email?: string; address?: string; }
interface SubscriptionCustomer {   // the READ shape — embedded on a Subscription
  phone?: string; fullName?: string; email?: string; address?: string;
  billing?: SubscriptionCustomerBilling | null;
  shipping?: SubscriptionCustomerShipping | null;
}
interface Subscription {
  subscriptionId: string; status: SubscriptionStatus; isActive: boolean;
  customer: SubscriptionCustomer; product: SubscriptionProduct;
  currentPeriodStart: string | null; currentPeriodEnd: string | null;
  nextBillingCycle: string | null; createdAt: string;
}
```

Note: on this **read** shape, `SubscriptionCustomerBilling`/`Shipping` fields
carry no `billing_`/`shipping_` wire prefix at all — that prefix only exists
on the **write** side (`CustomerInput`, below). See `subscriptions.md` for
the full explanation; this is the single easiest field-mapping mistake to
make in this SDK.

## `CustomerInput` — the WRITE shape, passed to `subscriptions.create`

```ts
interface CustomerInputBilling { businessName: string; email: string; address: string; panVat?: string; }
interface CustomerInputShipping { phone: string; fullName: string; email: string; address?: string; }
interface CustomerInput {
  phone: string; fullName: string; email: string; address: string;
  billing?: CustomerInputBilling; shipping?: CustomerInputShipping;
}
```

Wire-renamed as `client` at the top level only; `billing.*` fields get a
`billing_` wire prefix, `shipping.*` fields don't.

## `Customer` — the standalone `customers` resource's own shape

```ts
interface Customer {
  id: number;   // integer, not UUID — see customers.md
  buyerPhone: string | null; buyerEmail: string | null; fullName: string | null;
  createdAt: string;
}
```

Distinct from `SubscriptionCustomer` above — do not conflate the two.

## `CreateSubscriptionParams` / `CreateSubscriptionResponse` / `UpdateBillingCycleParams`

```ts
interface CreateSubscriptionParams { pbpId: string; returnUrl: string; customer: CustomerInput; }
interface CreateSubscriptionResponse {
  subscriptionId: string; pbpId: string; status: "pending_checkout";
  checkoutUrl: string; nextBillingCycle: string | null; createdAt: string;
}
interface UpdateBillingCycleParams { subscriptionId: string; nextBillingCycle: string; }
```

## `MessageResponse`

```ts
interface MessageResponse { message: string; }
```

Renamed from the wire's `Message` schema — see the renames table above.

## `Page<T>` / `SubscriptionPage<T>`

```ts
interface Page<T> { count: number; next: string | null; previous: string | null; results: T[]; }
type SubscriptionPage<T> = Page<T> & {
  totalSubscriptions: number; activeSubscriptions: number;
  dueSubscriptions: number; inactiveSubscriptions: number;
};
```

## `WebhookEvent` union

Stays snake_case — see `webhooks.md` for the full type definitions and why.

```ts
type WebhookEvent =
  | CheckoutSucceededEvent | CheckoutFailedEvent
  | SubscriptionStatusChangedEvent
  | ApiKeyCreatedEvent | ApiKeyDeletedEvent | ApiKeyExpiredEvent | ApiKeyExpiringSoonEvent;
```
