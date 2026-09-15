# Subscriptions

```ts
suqo.subscriptions.list(params?: PageParams): Promise<SubscriptionPage<Subscription>>   // GET /api/v1/subscriptions/
suqo.subscriptions.autoPaging(params?: PageParams): AsyncIterableIterator<Subscription>
suqo.subscriptions.create(params: CreateSubscriptionParams): Promise<CreateSubscriptionResponse>  // POST /api/v1/subscriptions/
suqo.subscriptions.cancel(id: string): Promise<MessageResponse>                          // POST /api/v1/subscriptions/{id}/cancel/
suqo.subscriptions.updateBillingCycle(params: UpdateBillingCycleParams): Promise<MessageResponse>  // POST /api/v1/subscriptions/update-billing-cycle/
suqo.subscriptions.resume(id: string): Promise<MessageResponse>                          // POST /api/v1/subscriptions/{id}/resume/
```

**No `retrieve(id)` exists on this resource.** Not a gap in the skill — a gap
in the SDK, per its own source comment ("still blocked on a real sample
response from backend"). If a task seems to need it, say so rather than
inventing a call.

## Create

```ts
interface CreateSubscriptionParams { pbpId: string; returnUrl: string; customer: CustomerInput; }
interface CreateSubscriptionResponse {
  subscriptionId: string; pbpId: string;
  status: "pending_checkout"; checkoutUrl: string;
  nextBillingCycle: string | null; createdAt: string;
}
```

`create()` returns a `checkoutUrl` to redirect the buyer to.
**`checkoutUrl` is not proof of payment.** The subscription starts
`pending_checkout`; the real outcome — success or failure — arrives later via
the `checkout.succeeded`/`checkout.failed` webhooks (see `webhooks.md`). Don't
mark anything as paid off the presence of a `checkoutUrl` alone.

**Reuse, not duplication, for a repeat buyer.** If the same buyer already has
an inactive or expired subscription for the same product + billing period,
`create()` reactivates it instead of making a new one. Only a subscription
that's currently **active** for that same combination throws a
`ValidationError` for a duplicate-active-subscription.

### `customer` — the field that's renamed on the wire, with an extra asymmetry

```ts
interface CustomerInput {
  phone: string; fullName: string; email: string; address: string;
  billing?: { businessName: string; email: string; address: string; panVat?: string };
  shipping?: { phone: string; fullName: string; email: string; address?: string };
}
```

The SDK calls this field `customer`; the wire calls it `client` (renamed
because `client` would collide with the SDK's own client object). Only the
**root key** is renamed — nested field names are not, with one further
wrinkle that's easy to get backwards:

- **On write**, `billing.*` fields get a `billing_` prefix
  (`businessName` → `billing_business_name`, `email` → `billing_email`,
  `address` → `billing_address`, `panVat` → `billing_pan_vat`) but
  `shipping.*` fields do **not** (`fullName` → `full_name`, not
  `shipping_full_name`).
- **On read** (the `customer` object embedded on a `Subscription`), neither
  nested object is prefixed — `business_name`, not `billing_business_name`.

This is a real backend quirk, not a bug to "fix" in generated code — write
code that matches it exactly rather than assuming symmetry. If `billing` is
omitted entirely on create, billing info is filled in server-side from the
buyer's existing profile; on a reuse/reactivation, only the fields you send
overwrite what's already on file.

## Cancel

`cancel(id)` **schedules** cancellation for the end of the current billing
period — it is not immediate. Status moves to `pending_cancellation`, not
straight to `cancelled`.

## Update billing cycle

```ts
interface UpdateBillingCycleParams { subscriptionId: string; nextBillingCycle: string; }  // "YYYY-MM-DD"
```

This is a **collection-level** call: `subscriptionId` travels in the request
body, not the URL path — unlike `cancel`/`resume`, which are path-templated
(`/subscriptions/{id}/cancel/`, `/subscriptions/{id}/resume/`). Easy to get
backwards if you're pattern-matching off `cancel`/`resume`. `nextBillingCycle`
must be today-or-future.

## Resume

`resume(id)` un-schedules a pending cancellation / reactivates. Confirmed
public and working, but its response shape is sourced from a Swagger example
only — the SDK's own comment flags it as "likely-correct-but-unverified,"
one notch less confidence than `cancel`/`updateBillingCycle`. Don't build
brittle logic on an exact field of its response without allowing for that.

## Status

```ts
SubscriptionStatus.PendingCheckout   // "pending_checkout"
SubscriptionStatus.Active            // "active"
SubscriptionStatus.Due               // "due"
SubscriptionStatus.Cancelled         // "cancelled"
SubscriptionStatus.PendingCancellation // "pending_cancellation"
SubscriptionStatus.Inactive          // "inactive"
```

`subscription.isActive` is `true` iff `status === "active"` — it's a
convenience flag, not independent state. The type stays open
(`| (string & {})`, see `api-surface.md`) so an unrecognized future status
still type-checks; narrow with `===` against a known constant, not an
exhaustive `switch`.

## Retries

None of `create`/`cancel`/`updateBillingCycle`/`resume` retry automatically —
no idempotency-key support exists yet (see `errors.md` and the SDK's own
`docs/user/idempotency.md`, explicitly marked "planned"). A `NetworkError`
from any of these means the write may or may not have landed; reconcile by
re-`list`ing rather than blindly resending.

`list`/`autoPaging` do retry (`NetworkError`/429/5xx, with backoff).

## Shape

```ts
interface SubscriptionProduct {
  productId: string; name: string; planName: string; pbpId: string; label: string;
  price: string; currency: string;
}
interface Subscription {
  subscriptionId: string; status: SubscriptionStatus; isActive: boolean;
  customer: SubscriptionCustomer;   // read shape — see models.md
  product: SubscriptionProduct;
  currentPeriodStart: string | null; currentPeriodEnd: string | null;
  nextBillingCycle: string | null; createdAt: string;
}
```

`currentPeriodEnd` and `nextBillingCycle` are documented as always equal —
don't treat a difference between them as meaningful. `product.price` stays a
string, same decimal rule as `products.md`.

`SubscriptionPage<T>` extends the common `Page<T>` with
`totalSubscriptions`/`activeSubscriptions`/`dueSubscriptions`/
`inactiveSubscriptions` counts — see `models.md`.

See `templates/create-subscription.ts` for a full `create()` call with the
error ladder, and `templates/manage-subscription.ts` for
`cancel`/`updateBillingCycle`/`resume`.
