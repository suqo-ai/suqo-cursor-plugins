<?php

/**
 * Laravel: bind SuqoClient as a singleton.
 *
 * Place at app/Providers/SuqoServiceProvider.php and register it. Add to
 * config/services.php:
 *
 *   'suqo' => [
 *       'key' => env('SUQO_API_KEY'),
 *       'timeout' => env('SUQO_TIMEOUT', 10.0),
 *       'max_retries' => env('SUQO_MAX_RETRIES', 2),
 *       'webhook_secret' => env('SUQO_WEBHOOK_SECRET'),
 *   ],
 *
 * Then inject SuqoClient into a controller, job or listener constructor. Never
 * call new SuqoClient() inside an action — it re-reads config per request and
 * hides misconfiguration until traffic arrives.
 */

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;
use Suqo\Exception\SuqoConfigError;
use Suqo\SuqoClient;

final class SuqoServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Singleton: immutable, no connection held, no request on construction.
        $this->app->singleton(SuqoClient::class, static function (Application $app): SuqoClient {
            try {
                return new SuqoClient(
                    apiKey: (string) config('services.suqo.key'),
                    // Per attempt, and it multiplies by retries. Keep it short in
                    // a request path; raise it in a queue worker.
                    timeout: (float) config('services.suqo.timeout', 10.0),
                    maxRetries: (int) config('services.suqo.max_retries', 2),
                    logLevel: $app->hasDebugModeEnabled() ? 'debug' : 'warn',
                );
            } catch (SuqoConfigError $e) {
                // SuqoConfigError extends \InvalidArgumentException, so a
                // catch (SuqoError) elsewhere will not see it.
                throw new \RuntimeException('SUQO is misconfigured: ' . $e->getMessage(), 0, $e);
            }
        });
    }

    /**
     * Resolve eagerly in a console context so a bad key fails at boot rather
     * than inside the first queued job.
     */
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->app->make(SuqoClient::class);
        }
    }
}
