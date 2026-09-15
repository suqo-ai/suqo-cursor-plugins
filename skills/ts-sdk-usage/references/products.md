# Products

```ts
suqo.products.list(params?: PageParams): Promise<Page<Product>>       // GET /api/v1/products/
suqo.products.autoPaging(params?: PageParams): AsyncIterableIterator<Product>
```

Read-only, no create/update/delete. **The only resource that works
pre-KYC** — reach for it first when a task doesn't need an authenticated
buyer yet (e.g. rendering a public pricing page).

`PageParams` is `{ page?: number; pageSize?: number }` — `pageSize` maps to
the wire's `page_size`, same as every other list call. Server default page
size is 20, server max is 100. Full pagination mechanics (manual paging for
a UI, `.autoPaging()`, and why an in-flight call can't be cancelled today)
are in `pagination.md`.

## The id chain into `subscriptions.create`

```
Product.plan[].billingPeriods[].pbpId
```

`pbpId` is the identifier `subscriptions.create({ pbpId, ... })` expects —
walk `product.plan` to the plan the buyer picked, then `plan.billingPeriods`
to the billing period (monthly/yearly/etc.), and pass that period's `pbpId`
straight through. See `subscriptions.md`.

## Field gotchas

- **Decimal fields are strings, end to end.** `price`, `vatPercentage`, and
  `totalSubscribers` come back as strings (e.g. `"500.00"`, `"13.00"`,
  `"42"`) and stay strings — never coerce them to `number`. Use them as
  display strings or parse with a decimal-safe library if you need to do
  arithmetic.
- `vat` can be `null` (not every product has VAT configured).
- `plan` and `billingPeriods` can legitimately come back empty — a product
  with no configured plans, or a plan with no active billing periods, is a
  valid response, not an error.

## Shape

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

Every property here is the plain camelCase of the wire's snake_case field —
no renames anywhere in this resource (`product_id` → `productId`,
`is_vat_active` → `isVatActive`, etc.). That's the common case across the
whole SDK; `models.md` has the short list of fields where that's *not* true.

See `templates/list-products.ts` for a runnable `autoPaging` walk down to
each billing period's `pbpId`.
