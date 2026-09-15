<?php

/**
 * SUQO webhook endpoint, no framework.
 *
 * Point the webhook URL at this file. Needs no API key — verification is
 * standalone: no client, no network.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Suqo\Webhook;

// 1. Raw bytes FIRST. The signature covers bytes, not structure: a body
//    re-serialised from a parse will never verify.
$raw = file_get_contents('php://input');

if ($raw === false) {
    http_response_code(400);
    exit;
}

$secret = getenv('SUQO_WEBHOOK_SECRET');

if (!is_string($secret) || $secret === '') {
    // Misconfiguration, not a bad request.
    error_log('SUQO_WEBHOOK_SECRET is not set');
    http_response_code(500);
    exit;
}

// 2. Verify. Never throws; returns false on every failure path.
$verified = Webhook::verify(
    rawBody: $raw,
    signature: $_SERVER['HTTP_X_SUQO_SIGNATURE'] ?? null,
    timestamp: $_SERVER['HTTP_X_SUQO_TIMESTAMP'] ?? null,
    secret: $secret,
);

if (!$verified) {
    // No detail in the response — which check failed is for our logs only.
    http_response_code(400);
    exit;
}

// 3. Parse only after verifying.
$event = json_decode($raw, true);

if (!is_array($event)) {
    http_response_code(400);
    exit;
}

// 4. Acknowledge fast, then process out of band. A slow handler gets retried
//    and duplicated.
http_response_code(200);

if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}

// 5. Be idempotent: redelivery is normal. Key on the event's own id (or the
//    subscription id plus a state transition) and treat a repeat as a no-op.
//    The SDK defines no event schema — read defensively.
$eventId = $event['id'] ?? $event['event_id'] ?? null;
$subscriptionId = $event['subscription_id'] ?? ($event['data']['subscription_id'] ?? null);

error_log(sprintf('suqo webhook event=%s subscription=%s', (string) $eventId, (string) $subscriptionId));

// enqueue($event);
