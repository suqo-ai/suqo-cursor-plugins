# SUQO PHP SDK — exact API surface

Every callable signature, verbatim. If something is not here, it does not exist —
say so rather than inventing it.

Namespace `Suqo\`, PSR-4. PHP 8.1+.

## `Suqo\SuqoClient`

```php
public function __construct(
    ?string $apiKey = null,                       // else $SUQO_API_KEY
    Environment|string|null $environment = null,  // a check, never an override
    ?float $timeout = null,                       // seconds, default 30.0, must be > 0
    ?int $maxRetries = null,                      // default 2, must be >= 0
    LogLevel|string|null $logLevel = null,        // else $SUQO_LOG, else 'warn'
    ?HttpClientInterface $httpClient = null,      // default new CurlHttpClient()
)                                                 // throws SuqoConfigError

public static function verifyWebhook(
    string $rawBody,
    ?string $signature,
    ?string $timestamp,
    string $secret,
    int $maxAge = 300,
): bool
```

Readonly properties: `config` (`Config`), `products`, `subscriptions`,
`customers`. The transport is private — there is no `request()` on the client.

## `Suqo\Resource\Products`

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Page          // Page<Product>; GET /api/v1/products/

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator     // Generator<int, Product>
```

## `Suqo\Resource\Subscriptions`

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): SubscriptionPage                     // GET /api/v1/subscriptions/

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator                            // Generator<int, Subscription>

public function create(
    CreateSubscriptionParams $params,
    ?Cancellation $cancellation = null,
): CreateSubscriptionResponse           // POST /api/v1/subscriptions/

public function cancel(
    string $id,
    ?Cancellation $cancellation = null,
): MessageResponse                      // POST /api/v1/subscriptions/{id}/cancel/

public function updateBillingCycle(
    UpdateBillingCycleParams $params,
    ?Cancellation $cancellation = null,
): MessageResponse                      // POST /api/v1/subscriptions/update-billing-cycle/
```

All five throw `Suqo\Exception\SuqoError` or a subclass. `list` and `autoPaging`
are retried on 0/429/5xx; the three writes are not retried at all.

## `Suqo\Resource\Customers` — every method throws

```php
public function list(?int $page = null, ?int $pageSize = null, ?Cancellation $cancellation = null): never
public function autoPaging(?int $page = null, ?int $pageSize = null, ?Cancellation $cancellation = null): Generator
public function read(string $id, ?Cancellation $cancellation = null): never
```

Each raises `NotImplementedError` with the message
`customers API not yet available in this SDK version`, `status` `0`. `autoPaging`
throws on **call**, not on first iteration. `Suqo\Model\Customer` is a real
record type (`id`, `buyerPhone`, `buyerEmail`, `fullName`, `createdAt`) but
nothing returns one yet.

## Params objects — `Suqo\Params\*`

All take named arguments and end with `array $extra = []`, merged into the body
under wire names verbatim (a declared key always wins over an `extra` key).
`toWire(): array` is public, so the exact body can be inspected without a
request.

```php
new CreateSubscriptionParams(
    string $pbpId,                       // wire pbp_id
    CustomerInput $customer,             // wire client
    ?string $returnUrl = null,           // wire return_url, omitted when null
    array $extra = [],
)

new CustomerInput(
    string $phone,                       // wire phone
    string $fullName,                    // wire full_name
    string $email,                       // wire email
    ?string $address = null,             // omitted when null
    ?CustomerBilling $billing = null,    // omitted when null
    ?CustomerShipping $shipping = null,  // omitted when null
    array $extra = [],
)

new CustomerBilling(
    string $billingBusinessName,         // wire billing_business_name
    string $billingEmail,                // wire billing_email
    string $billingAddress,              // wire billing_address
    ?string $billingPanVat = null,       // wire billing_pan_vat, omitted when null
    array $extra = [],
)

new CustomerShipping(
    string $phone,
    string $fullName,
    string $email,
    ?string $address = null,
    array $extra = [],
)

new UpdateBillingCycleParams(
    string $subscriptionId,              // wire subscription_id
    string $nextBillingCycle,            // wire next_billing_cycle, "YYYY-MM-DD"
    array $extra = [],
)
```

`CustomerInput`, `CustomerBilling` and `CustomerShipping` also have
`static fromWire(array $wire): self`, because the API returns the same schema on
a 201. `CreateSubscriptionParams` and `UpdateBillingCycleParams` do not.

## Response types — `Suqo\Model\*`

Every model has a private constructor plus `static fromWire(array $wire): self`,
and inherits `toArray(): array` — the decoded payload with wire names intact.
Never construct a model directly; read the one a method returned.

```php
Page             int $count, ?string $next, ?string $previous, array $results
                 static fromWire(array $wire, callable $factory): self   // public constructor
SubscriptionPage extends Page: ?int $totalSubscriptions, $activeSubscriptions,
                 $dueSubscriptions, $inactiveSubscriptions
                 static fromSubscriptionsWire(array $wire): self
MessageResponse  string $message
```

Record property lists are in `models.md`.

## Enums

```php
enum Suqo\Environment: string { Live = 'live'; Sandbox = 'sandbox'; }
    public function baseUrl(): string                 // https://be.suqo.ai | https://test-be.suqo.ai

enum Suqo\LogLevel: string { Debug; Info; Warn; Error; Off; }
    public function severity(): int                   // 10 20 30 40 100
    public function emits(self $level): bool

enum Suqo\Model\SubscriptionStatus: string {
    PendingCheckout = 'pending_checkout'; Active = 'active'; Due = 'due';
    Cancelled = 'cancelled'; PendingCancellation = 'pending_cancellation';
    Inactive = 'inactive';
}
    public static function parse(mixed $value): self|string|null
```

`Subscription::$status` is typed `SubscriptionStatus|string|null` — a case when
recognised, the raw string when not, `null` when absent.

## Cancellation

```php
Suqo\Cancellation::none(): self     // a fresh, never-cancelled token
$token->cancel(): void              // one-way latch, idempotent
$token->isCancelled(): bool
```

Pass `cancellation:` to any request method. Honoured before an attempt,
mid-flight, during retry backoff, and at each page boundary. Raises
`CancelledError`, which is never retried.

## Exceptions — `Suqo\Exception\*`

```
\RuntimeException
└── SuqoError                 status, requestId, rawBody, fieldErrors, retryAfter
    ├── AuthenticationError   401
    ├── KycRequiredError      403 + KYC body; adds ?string $kycStatus (wire status_code)
    ├── ValidationError       400; the only type that fills fieldErrors
    ├── NotFoundError         404
    ├── RateLimitError        429; check retryAfter
    ├── ServerError           >= 500
    ├── NetworkError          transport failure or timeout, status 0
    ├── CancelledError        caller cancelled, status 0, never retried
    └── NotImplementedError   customers resource, status 0

\InvalidArgumentException
└── SuqoConfigError           bad config at construction — NOT a SuqoError
```

`ErrorMapper::map(int $status, mixed $body, string $requestId, ?float $retryAfter = null): SuqoError`
is public for a custom transport; it returns the error rather than throwing.

## Advanced / extension points

Only reach for these when the task genuinely needs them.

```php
Suqo\Config::resolve(...same six args as the client...): self     // private constructor
Suqo\Http\HttpClientInterface::send(HttpRequest): HttpResponse    // the whole interface
Suqo\Http\CurlHttpClient::__construct(array $curlOptions = [])
Suqo\Http\Psr18HttpClient::__construct(ClientInterface, RequestFactoryInterface, StreamFactoryInterface)
Suqo\Http\HttpResponse::__construct(int $status, array $headers, string $body)
Suqo\Http\HttpResponse::header(string $name): ?string
Suqo\Http\Transport::request(string $method, string $path, ?array $body = null, array $query = [], ?Cancellation = null): TransportResponse
Suqo\Http\Transport::url(string $path, array $query = []): string
Suqo\Http\Transport::getAbsolute(string $url, ?Cancellation = null): TransportResponse
Suqo\Http\TransportResponse::object(): array
Suqo\Http\RetryPolicy::execute(string $method, Cancellation, callable $attempt): mixed
Suqo\Http\RetryPolicy::isEligible(string $method, SuqoError): bool
Suqo\Http\RetryPolicy::computeDelayMs(int $attempt, SuqoError): int
Suqo\Http\UrlBuilder::build(string $path, array $query = []): string
Suqo\Pagination::autoPage(Transport, string $firstUrl, callable $factory, ?Cancellation = null): Generator
Suqo\Endpoints::PRODUCTS | ::SUBSCRIPTIONS | ::SUBSCRIPTION_BILLING_CYCLE
Suqo\Endpoints::subscriptionCancel(string $id): string
Suqo\Constants::writesRetryable(): bool
Suqo\Logging\Logger::debug|info|warn|error(string $event, array $context = []): void
```

`Suqo\Model\Wire` (`nstr`, `str`, `decimal`, `nint`, `int`, `count`, `nbool`,
`object`, `objectList`) is marked `@internal` — usable when writing a model, but
carries no stability guarantee.

There is **no** logger injection point and **no** header hook. Set `logLevel`;
wrap `HttpClientInterface` if you need to see or alter requests.
