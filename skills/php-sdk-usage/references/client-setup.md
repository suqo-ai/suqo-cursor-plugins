# Client setup and configuration

## The minimum

```php
use Suqo\SuqoClient;

$suqo = new SuqoClient();     // api key from $SUQO_API_KEY
```

Construction makes no network request. It resolves and validates config, then
builds the transport and the three resources.

## Options

Always named arguments.

```php
$suqo = new SuqoClient(
    apiKey: 'su_test_key_…',
    environment: 'sandbox',   // optional; must agree with the key prefix
    timeout: 30.0,            // seconds, per attempt; must be > 0
    maxRetries: 2,            // retries after the first attempt; must be >= 0
    logLevel: 'warn',         // debug | info | warn | error | off
);
```

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | `$SUQO_API_KEY` | Must start `su_test_key_` or `su_key_`. |
| `environment` | inferred | A check, never an override. |
| `timeout` | `30.0` | Seconds; applies to connect and total, per attempt. |
| `maxRetries` | `2` | `2` means three attempts. `GET` only. |
| `logLevel` | `$SUQO_LOG`, else `warn` | Diagnostics go to `STDERR`. |
| `httpClient` | `new CurlHttpClient()` | Any `HttpClientInterface`. |

`$SUQO_API_KEY` is read via `getenv()`, then `$_ENV`, then `$_SERVER` — so a
`.env` loader that only populates one of them still works.

## Environment is derived, not chosen

`su_test_key_…` → sandbox → `https://test-be.suqo.ai`
`su_key_…` → live → `https://be.suqo.ai`

Passing `environment:` can only agree with the prefix or raise
`SuqoConfigError`. To switch environments, switch keys. Never build a config
flag that tries to force live behaviour out of a test key — it cannot work, and
the error will confuse whoever hits it.

```php
echo $suqo->config->environment->value;   // "sandbox"
echo $suqo->config->baseUrl;              // "https://test-be.suqo.ai"
```

## Failing fast at boot

```php
use Suqo\Exception\SuqoConfigError;
use Suqo\SuqoClient;

try {
    $suqo = new SuqoClient();
} catch (SuqoConfigError $e) {
    fwrite(STDERR, 'SUQO config: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
```

`SuqoConfigError extends \InvalidArgumentException`, **not** `SuqoError`. Raised
for: a missing or malformed key, an `environment` that disagrees with the
prefix, an unparseable `environment` or `logLevel` string, `timeout <= 0`,
`maxRetries < 0`.

To validate a key without building a client, use `Config::resolve(apiKey: $k)`
— same parameters, same error.

An unrecognised `$SUQO_LOG` value is ignored and the default is used; an
unrecognised `logLevel` *argument* throws.

## Laravel

Bind it as a singleton in a service provider. `SuqoClient` is immutable and
holds no connection, so one instance per process is correct.

```php
// app/Providers/SuqoServiceProvider.php
use Illuminate\Contracts\Foundation\Application;
use Suqo\SuqoClient;

public function register(): void
{
    $this->app->singleton(SuqoClient::class, static fn (Application $app): SuqoClient => new SuqoClient(
        apiKey: (string) config('services.suqo.key'),
        timeout: (float) config('services.suqo.timeout', 30.0),
        logLevel: $app->hasDebugModeEnabled() ? 'debug' : 'warn',
    ));
}
```

```php
// config/services.php
'suqo' => [
    'key' => env('SUQO_API_KEY'),
    'timeout' => env('SUQO_TIMEOUT', 30.0),
    'webhook_secret' => env('SUQO_WEBHOOK_SECRET'),
],
```

Then inject `SuqoClient` into a controller or job constructor. Never call
`new SuqoClient()` inside a controller method — it re-reads config on every
request and hides misconfiguration until traffic arrives.

Do not put the key in `config()` without `env()` behind it, and never commit it.
`config:cache` bakes the value in, which is what you want in production.

See `templates/laravel-service-provider.php`.

## Symfony

```yaml
# config/services.yaml
services:
    Suqo\SuqoClient:
        arguments:
            $apiKey: '%env(SUQO_API_KEY)%'
            $timeout: 30.0
            $logLevel: '%env(default:suqo_log:SUQO_LOG)%'
```

Autowiring then injects it anywhere. The constructor's named parameters map
directly onto Symfony's `$name` argument syntax.

## Plain PHP and Slim

One factory, called once, wherever your container lives:

```php
// bootstrap/suqo.php
declare(strict_types=1);

use Suqo\SuqoClient;

return static function (): SuqoClient {
    static $client = null;

    return $client ??= new SuqoClient(
        apiKey: (string) (getenv('SUQO_API_KEY') ?: ''),
        logLevel: getenv('APP_DEBUG') ? 'debug' : 'warn',
    );
};
```

See `templates/suqo-client.php`.

## Timeouts and retries in practice

- `timeout` is **per attempt**. With `maxRetries: 2` the worst case is roughly
  three timeouts plus two backoffs, so a 30 s timeout can mean ~95 s of wall
  clock. In a web request, lower it: `timeout: 5.0, maxRetries: 1`.
- Retries apply to `GET` only, on status 0 (network/timeout), 429, or 5xx.
  Backoff is full jitter — a uniform draw across `[0, cap)` with
  `cap = min(8000, 500 * 2 ** attempt)` ms — and a numeric `Retry-After` wins,
  capped at 60 s.
- In a queue worker, prefer `maxRetries: 0` and let the queue's own retry
  policy own the backoff, so you are not nesting two.

## Logging

There is no logger injection point. Set `logLevel` (or `$SUQO_LOG`) and the SDK
writes to `STDERR`:

```
[suqo] debug request {"method":"GET","url":"https://…/api/v1/products/","request_id":"…"}
[suqo] debug response {"status":200,"request_id":"…","elapsed_ms":184}
[suqo] warn  retry {"attempt":1,"delay":412}
```

The API key is never logged. To route diagnostics into your own logger, wrap the
HTTP client instead.

## Injecting an HTTP client

```php
use Suqo\Http\CurlHttpClient;
use Suqo\Http\Psr18HttpClient;

// cURL options you control: proxy, CA bundle, interface binding.
$suqo = new SuqoClient(httpClient: new CurlHttpClient([CURLOPT_PROXY => '…']));

// Any PSR-18 client (needs psr/http-client + psr/http-factory).
$suqo = new SuqoClient(httpClient: new Psr18HttpClient($client, $requestFactory, $streamFactory));
```

`CurlHttpClient` applies your options first, then overwrites what it must
control (URL, method, `RETURNTRANSFER`, `FOLLOWLOCATION` off, both timeouts,
headers, body, header collector, progress callback). So a proxy works;
overriding `CURLOPT_TIMEOUT_MS` does not.

`Psr18HttpClient` has two inherent limits: PSR-18 cannot express a per-request
timeout (set it on your own client), and cancellation is only checked at the
boundaries, never mid-flight.

Writing your own is one method — see the testing section of `SKILL.md` for the
pattern, and `references/api-surface.md` for the two exceptions it may throw
(`HttpCancelledException` → `CancelledError`, `HttpClientException` →
`NetworkError`). Return an `HttpResponse` for every status, 5xx included; the
transport maps statuses, so never throw on one.

## What the transport sends

Per attempt: `Authorization: Bearer {apiKey}`, a fresh `X-Request-Id` UUID v4,
and `Content-Type: application/json` only when there is a body. No
`User-Agent`. Each retry carries a **new** request id, so quote the id from the
error, not from an earlier log line.
