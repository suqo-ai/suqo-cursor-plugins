<?php

/**
 * Auto-paging read with a cancellation token.
 *
 * Run: SUQO_API_KEY=su_test_key_… php list-products.php
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Suqo\Cancellation;
use Suqo\Exception\CancelledError;
use Suqo\Exception\SuqoError;
use Suqo\SuqoClient;

$suqo = new SuqoClient();

// A one-way latch. Tripped here by SIGTERM/SIGINT; honoured before an attempt,
// mid-flight, during retry backoff and at each page boundary.
$token = new Cancellation();

if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, static fn () => $token->cancel());
    pcntl_signal(SIGINT, static fn () => $token->cancel());
}

$seen = 0;

try {
    // Lazy: a page is fetched only once the previous one is exhausted, so
    // breaking out of this loop genuinely stops the requests. Errors surface
    // from the foreach, not from the call above.
    foreach ($suqo->products->autoPaging(pageSize: 100, cancellation: $token) as $product) {
        $seen++;

        printf("%s  %s\n", $product->productId ?? '-', $product->name ?? '-');

        // vat and totalSubscribers are decimal STRINGS. Never cast to float.
        printf("  vat %s  subscribers %s\n", $product->vat ?? '-', $product->totalSubscribers ?? '-');

        foreach ($product->plan as $plan) {
            printf("  plan %s  %s  %s\n", $plan->planId ?? '-', $plan->planName ?? '-', $plan->billingPeriods ?? '-');
        }
    }
} catch (CancelledError $e) {
    // We stopped it. Never retried, and distinct from a timeout's NetworkError.
    fwrite(STDERR, sprintf("cancelled after %d products\n", $seen));
    exit(130);
} catch (SuqoError $e) {
    // Partial progress has already happened — make any write in the loop idempotent.
    fwrite(STDERR, sprintf("suqo %d req=%s: %s\n", $e->status, $e->requestId, $e->getMessage()));
    exit(1);
}

printf("%d products\n", $seen);
