# Pagination

Every list endpoint (`products.list()`, `subscriptions.list()`,
`customers.list()`) returns the same envelope shape and offers two ways to
walk it — manual `page`/`pageSize`, or `.autoPaging()`.

## The envelope

```ts
interface Page<T> {
  count: number;         // total rows across every page, not just this one
  next: string | null;   // URL of the next page, or null on the last page
  previous: string | null;
  results: T[];
}
```

`subscriptions.list()` returns a superset — `SubscriptionPage<T>` — with
four extra counts alongside `results`:

```ts
type SubscriptionPage<T> = Page<T> & {
  totalSubscriptions: number;
  activeSubscriptions: number;
  dueSubscriptions: number;
  inactiveSubscriptions: number;
};
```

## Manual paging — for a UI paging control

Pass `page`/`pageSize` yourself when you genuinely want one page at a time
(e.g. Next/Previous buttons in an admin table), rather than walking
everything:

```ts
interface PageParams { page?: number; pageSize?: number; }   // pageSize -> wire page_size

const page1 = await suqo.products.list({ page: 1, pageSize: 50 });
const page2 = await suqo.products.list({ page: 2, pageSize: 50 });
```

`pageSize` maps to the wire's `page_size` query param — never write
`page_size` yourself. Server default is 20 if `pageSize` is omitted, with a
server-side max of 100. `page.count`/`page.next`/`page.previous` are what a
paging control needs to render "page N of M" and enable/disable
Next/Previous. See `templates/list-products-paged.ts` for a worked example.

## `.autoPaging()` — walk every row without page math

Every paginated resource also exposes `.autoPaging()`, which follows `next`
until it's `null` and yields items one at a time:

```ts
for await (const product of suqo.products.autoPaging({ pageSize: 100 })) {
  // product: Product — every product across every page, no manual page tracking
}
```

It takes the same params as `.list()`. Returns an `AsyncIterableIterator`,
so it also works via `.next()` directly if you're not in a `for await` loop.
`.autoPaging()` is additive, not a replacement — manual `.list({page,
pageSize})` keeps working exactly as before for the UI-paging-control case
above.

## The underlying helpers (not usually called directly)

```ts
function toPageQuery(params?: PageParams): QueryParams
function deserializePage<TWireItem, T>(wire: Page<TWireItem>, deserializeItem: (item: TWireItem) => T): Page<T>
function listAll<T>(firstPage: Page<T>, fetchNext: (nextUrl: string) => Promise<Page<T>>, maxPages?: number): AsyncIterableIterator<T>
function bridgeAutoPaging<T>(fetchFirstPage: () => Promise<Page<T>>, fetchNext: (nextUrl: string) => Promise<Page<T>>, maxPages?: number): AsyncIterableIterator<T>
```

Each resource's `.autoPaging()` is built on `bridgeAutoPaging`/`listAll`
internally — exported mainly so the SDK's own tests can exercise the
iteration logic directly. `maxPages` defaults to `10_000` and exists purely
as a stuck-loop guard: exceeding it without ever reaching `next: null`
throws, rather than looping forever against a misbehaving server.

## No cancellation reachable from `.list()`/`.autoPaging()` today

The internal HTTP layer supports a per-call `AbortSignal`/`timeoutMs`, but
**no public resource method exposes it** — `list(params?: PageParams)`,
`autoPaging(params?: PageParams)`, and every other public method take only
the params shown above, nothing signal-shaped. If you need to cancel an
in-flight list (e.g. a component unmounting mid-request, or a user
navigating away), there is currently no supported way to do that per-call;
the honest options are to let it resolve and discard the result, or to
construct a new `SuqoClient` with a short `timeout` for that specific
operation. Don't tell a caller to "cancel per HTTP call" as if a documented
mechanism exists for it — it doesn't, on the current public surface.
