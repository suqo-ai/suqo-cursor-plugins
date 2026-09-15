<?php

/**
 * SUQO client factory.
 *
 * One instance per process: SuqoClient is immutable, holds no connection and
 * makes no request when constructed. Fail at boot rather than mid-request, so a
 * missing or malformed key is a deploy-time error.
 *
 * Usage:
 *   $suqo = (require __DIR__ . '/suqo-client.php')();
 */

declare(strict_types=1);

use Suqo\Exception\SuqoConfigError;
use Suqo\SuqoClient;

return static function (): SuqoClient {
    static $client = null;

    if ($client instanceof SuqoClient) {
        return $client;
    }

    $key = getenv('SUQO_API_KEY');

    if (!is_string($key) || $key === '') {
        throw new RuntimeException('SUQO_API_KEY is not set.');
    }

    try {
        // The environment is inferred from the key prefix — su_test_key_ is
        // sandbox, su_key_ is live. Passing environment: is a check, not a switch.
        return $client = new SuqoClient(
            apiKey: $key,
            // Per attempt. Keep it short in a web request: with maxRetries: 2 the
            // worst case is three timeouts plus two backoffs.
            timeout: (float) (getenv('SUQO_TIMEOUT') ?: 10.0),
            maxRetries: (int) (getenv('SUQO_MAX_RETRIES') ?: 2),
            logLevel: getenv('APP_DEBUG') ? 'debug' : 'warn',
        );
    } catch (SuqoConfigError $e) {
        // Not a SuqoError — it extends \InvalidArgumentException.
        throw new RuntimeException('SUQO config: ' . $e->getMessage(), 0, $e);
    }
};
