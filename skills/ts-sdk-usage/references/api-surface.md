# SUQO TypeScript SDK — exact API surface

Every exported signature, verbatim, from `src/index.ts` — the SDK's own
comment calls that file "the single, complete public export surface... Nothing
outside this file's exports is part of the public contract." If something is
not here, it does not exist — say so rather than inventing it.

Package `@suqo/sdk`, ESM + CJS, `strict` TypeScript, Node ≥18. Published on
npm — see `client-setup.md` for install.

## `SuqoClient`

```ts
interface SuqoClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;     // ms, default 30_000
  maxRetries?: number;  // default 2 (3 attempts total, reads only)
  dispatcher?: unknown; // undici Dispatcher — forwarded into every fetch() call verbatim
}

class SuqoClient {
  readonly products: ProductsResource;
  readonly subscriptions: SubscriptionsResource;
  readonly customers: CustomersResource;
  readonly webhooks: WebhooksResource;

  constructor(options: SuqoClientOptions)   // throws SuqoConfigError

  get environment(): SuqoEnvironment;       // "sandbox" | "live"
  get baseUrl(): string;
  get timeout(): number;
  get maxRetries(): number;

  toJSON(): Record<string, unknown>;        // redacts apiKey as "[redacted]"
}
```

The four resource properties are the only way to reach a resource — none of
`ProductsResource`/`SubscriptionsResource`/`CustomersResource`/
`WebhooksResource` is exported from `src/index.ts`, so they can't be imported
or constructed directly. `webhooks` is constructed with no arguments at all
(`new WebhooksResource()`) since verification makes no network call and needs
no key.

## `suqo.products`

```ts
list(params?: PageParams): Promise<Page<Product>>       // GET /api/v1/products/
autoPaging(params?: PageParams): AsyncIterableIterator<Product>
```

Read-only. The only resource that works pre-KYC. No create/update/delete.

## `suqo.subscriptions`

```ts
list(params?: PageParams): Promise<SubscriptionPage<Subscription>>   // GET /api/v1/subscriptions/
autoPaging(params?: PageParams): AsyncIterableIterator<Subscription>
create(params: CreateSubscriptionParams): Promise<CreateSubscriptionResponse> // POST /api/v1/subscriptions/
cancel(id: string): Promise<MessageResponse>                         // POST /api/v1/subscriptions/{id}/cancel/
updateBillingCycle(params: UpdateBillingCycleParams): Promise<MessageResponse> // POST /api/v1/subscriptions/update-billing-cycle/
resume(id: string): Promise<MessageResponse>                         // POST /api/v1/subscriptions/{id}/resume/
```

**There is no `retrieve(id)` on this resource.** Not undocumented — not
implemented, per the SDK's own source comment ("still blocked on a real
sample response from backend"). Don't write a call to it.

`updateBillingCycle` is collection-level: the id travels in the request body
(`subscription_id`), not the URL path — unlike `cancel`/`resume`, which are
path-templated. All five throw a `SuqoError` subclass. `list`/`autoPaging`
retry on `NetworkError`/429/5xx; `create`/`cancel`/`updateBillingCycle`/
`resume` never retry.

`resume()`'s response shape is flagged in the SDK's own source as
"likely-correct-but-unverified" (built from a Swagger example only, unlike
every other write here, which is independently confirmed) — treat it with
one notch less confidence than `cancel`/`updateBillingCycle`.

## `suqo.customers`

```ts
list(params?: PageParams): Promise<Page<Customer>>     // GET /api/v1/customers/
autoPaging(params?: PageParams): AsyncIterableIterator<Customer>
retrieve(id: number): Promise<Customer>                 // GET /api/v1/customers/{id}/ — id is a NUMBER
```

Read-only — no create/update/delete; a customer record is created implicitly
the first time someone subscribes. This is a real, working, tested resource
(`test/contract/requestShape.test.ts` covers `list`/`retrieve` against a mock
server; `test/resources/customers.test.ts` covers `autoPaging` separately).
**`specs/SDK-SPEC.md` §11 and `docs/typescript-addendum.md` §6
in the SDK repo both still describe this resource as an unimplemented stub
that throws — that is stale.** Source, tests, `docs/user/customers.md`, and
`examples/list-customers.ts` all agree it's real; treat those as ground
truth, not the spec/addendum. Full detail in `customers.md`.

## `suqo.webhooks`

```ts
interface VerifyWebhookOptions {
  rawBody: string | Buffer;
  signature: string;      // "X-SUQO-Signature" header, e.g. "sha256=<hex>"
  timestamp: string;      // "X-SUQO-Timestamp" header, Unix seconds as a string
  secret: string;
  toleranceSec?: number;  // default 300
}

verify(options: VerifyWebhookOptions): boolean
```

Makes no network call and the API key plays no role in verification — but
it's still a method on an already-constructed `SuqoClient`, since
`WebhooksResource` isn't exported for standalone construction. **Never
throws**: every failure mode returns `false`. Full detail in `webhooks.md`.

Event payload types, exported for use after `verify()` returns `true` and
you `JSON.parse(rawBody)` yourself: `WebhookEvent` (the union),
`WebhookEventType`, `CheckoutSucceededEvent`, `CheckoutFailedEvent`,
`SubscriptionStatusChangedEvent`, `ApiKeyCreatedEvent`, `ApiKeyDeletedEvent`,
`ApiKeyExpiredEvent`, `ApiKeyExpiringSoonEvent`. Full shapes in
`webhooks.md`.

## `mapHttpError`

```ts
interface HttpErrorInput {
  status: number;
  statusText?: string;
  body?: unknown;
  requestId?: string;
  retryAfter?: number;
}

function mapHttpError(input: HttpErrorInput): SuqoError
```

The single status→error-class mapper every resource call routes through
internally. Exported for anyone building a custom transport around the same
rules. Full hierarchy in `errors.md`.

## Pagination helpers

```ts
interface Page<T> { count: number; next: string | null; previous: string | null; results: T[]; }
interface PageParams { page?: number; pageSize?: number; }   // pageSize -> wire page_size
type SubscriptionPage<T> = Page<T> & {
  totalSubscriptions: number; activeSubscriptions: number;
  dueSubscriptions: number; inactiveSubscriptions: number;
};

function toPageQuery(params?: PageParams): QueryParams
function deserializePage<TWireItem, T>(wire: Page<TWireItem>, deserializeItem: (item: TWireItem) => T): Page<T>
function listAll<T>(firstPage: Page<T>, fetchNext: (nextUrl: string) => Promise<Page<T>>, maxPages?: number): AsyncIterableIterator<T>
function bridgeAutoPaging<T>(fetchFirstPage: () => Promise<Page<T>>, fetchNext: (nextUrl: string) => Promise<Page<T>>, maxPages?: number): AsyncIterableIterator<T>
```

Manual `page`/`pageSize` paging, `.autoPaging()`, the `maxPages` stuck-loop
guard, and why there's no way to cancel an in-flight list call from public
code today are all covered in full in `pagination.md`.

## `VERSION`

```ts
const VERSION: string;   // the installed package version, e.g. "1.0.0"
```

## Enums / unions

```ts
const SubscriptionStatus = {
  PendingCheckout: "pending_checkout", Active: "active", Due: "due",
  Cancelled: "cancelled", PendingCancellation: "pending_cancellation", Inactive: "inactive",
} as const;
type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus] | (string & {});
```

The trailing `| (string & {})` is deliberate, not a typo — it keeps the union
open so a status value added server-side still type-checks instead of being
rejected, while editor autocomplete still suggests the six known literals.
Narrow with strict `===` against `SubscriptionStatus.Active` etc., not an
exhaustive `switch`, or a new server-side status silently falls through.

Full model property lists are in `models.md`; the full error hierarchy is in
`errors.md`; webhook event payload types are in `webhooks.md`.

## Not public — don't reach for these

Exported from their own module for the SDK's own unit tests, or simply never
exported from `src/index.ts` at all. None of this is part of the contract;
don't import it into generated code and don't document behavior based on it.

- `src/client/index.ts` — a dead stub (`export {}`). The real, working client
  is the sibling file `src/client.ts`, which is what `src/index.ts` actually
  imports from. Don't be misled by the directory name.
- `src/auth/index.ts` — also a stub (`export {}`). Authentication is one
  inline `Authorization: Bearer <apiKey>` header set directly inside the
  internal HTTP layer; there's no separate auth module, no token refresh.
- `HttpClient`, `SdkConfig`, `resolveEnvironment` and everything under
  `src/http/`, `src/config/`, `src/auth/` — all internal.
- `serializeCustomerInput`, `deserializeSubscriptionCustomer`,
  `deserializeProduct`, `deserializePlan`, `deserializeBillingPeriod`,
  `deserializeSubscription`, `deserializeSubscriptionPage`,
  `deserializeCreateSubscriptionResponse`, `deserializeCustomer` — each
  exported from its resource file only for direct unit testing, explicitly
  commented "not part of the SDK's public surface."

One more discipline note: `src/http/HttpClient.ts`'s own class docstring
still says "Not wired into `SuqoClient`/any resource yet — that lands in
Ticket 4," but `src/client.ts` demonstrably does wire it
(`new HttpClient(this.#config)`, handed to every resource). Treat source +
tests as ground truth over any comment or spec that hasn't caught up —
this is the second confirmed instance of that in this SDK, not a one-off.
