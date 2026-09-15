# Customers

```ts
suqo.customers.list(params?: PageParams): Promise<Page<Customer>>      // GET /api/v1/customers/
suqo.customers.autoPaging(params?: PageParams): AsyncIterableIterator<Customer>
suqo.customers.retrieve(id: number): Promise<Customer>                  // GET /api/v1/customers/{id}/
```

Read-only — no create/update/delete. A customer record is created implicitly
the first time someone subscribes; there is no separate "register a
customer" call.

## Read this before trusting any other doc about this resource

**`specs/SDK-SPEC.md` §11 and `docs/typescript-addendum.md` §6 in the SDK
repo both still describe this resource as an unimplemented stub** — the spec
says every method "throws `SuqoError(\"customers API not yet available in
this SDK version\")`". **That is stale.** The real
`src/resources/customers.ts` implements all three methods for real, hitting
the endpoints above; `test/contract/requestShape.test.ts` exercises
`list`/`retrieve` against a mock server and `test/resources/customers.test.ts`
covers `autoPaging` separately; `docs/user/customers.md` and
`examples/list-customers.ts` both describe and use it as fully working. Treat source + tests + `docs/user/` as
ground truth for this resource — the spec and addendum simply haven't caught
up to the implementation yet.

## The one id that isn't a UUID

```ts
interface Customer {
  id: number;   // a plain integer — NOT a UUID, unlike every other id in the SDK
  buyerPhone: string | null;
  buyerEmail: string | null;
  fullName: string | null;
  createdAt: string;
}
```

`retrieve(id)` takes that same integer. Every other resource in this SDK
identifies records with a UUID-shaped string (`subscriptionId`, `productId`,
`pbpId`, ...); this is the one exception. Don't assume you can pass a UUID
here, and don't assume this `id` means anything outside this resource.

## Not the same type as the `customer` on a `Subscription`

This `Customer` record (this resource's own shape, above) is a genuinely
different type from `SubscriptionCustomer` — the object embedded under
`subscription.customer` when you call `subscriptions.list`/`create` (see
`subscriptions.md`, `models.md`). The SDK never conflates them, and neither
should generated code: don't assume a `Customer.id` shows up anywhere on a
`Subscription`, and don't assume `SubscriptionCustomer`'s fields (`phone`,
`fullName`, `billing`, `shipping`, ...) exist on `Customer` — they don't
overlap beyond `fullName`.
