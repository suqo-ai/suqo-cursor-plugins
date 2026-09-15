<?php

/**
 * Laravel: SUQO webhook controller.
 *
 * Route (routes/web.php or routes/api.php):
 *
 *   Route::post('/webhooks/suqo', SuqoWebhookController::class)
 *       ->withoutMiddleware([\Illuminate\Foundation\Http\Middleware\VerifyCsrfToken::class]);
 *
 * On an older app, exclude the path in App\Http\Middleware\VerifyCsrfToken::$except
 * instead. Keep the route out of any middleware that reads or rewrites the body.
 *
 * config/services.php:
 *   'suqo' => ['webhook_secret' => env('SUQO_WEBHOOK_SECRET')],
 */

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Jobs\ProcessSuqoWebhook;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Suqo\Webhook;

final class SuqoWebhookController extends Controller
{
    public function __invoke(Request $request): Response
    {
        // Raw bytes. NOT $request->all() or json_encode of anything — the
        // signature covers bytes, not structure.
        $raw = $request->getContent();

        $secret = (string) config('services.suqo.webhook_secret');

        if ($secret === '') {
            report(new \RuntimeException('SUQO webhook secret is not configured'));

            return response('', 500);
        }

        // Header lookup is case-insensitive. Verification needs no API key.
        $verified = Webhook::verify(
            rawBody: $raw,
            signature: $request->header('X-Suqo-Signature'),
            timestamp: $request->header('X-Suqo-Timestamp'),
            secret: $secret,
        );

        if (!$verified) {
            // No detail leaks outward.
            return response('', 400);
        }

        $event = json_decode($raw, true);

        if (!is_array($event)) {
            return response('', 400);
        }

        // Acknowledge fast; do the work on the queue. The job must be
        // idempotent — redelivery is normal, and the SDK keeps no replay store.
        ProcessSuqoWebhook::dispatch($event);

        return response('', 200);
    }
}
