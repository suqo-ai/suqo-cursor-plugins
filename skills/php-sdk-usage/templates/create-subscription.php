<?php

/**
 * Create a subscription, with the full error ladder.
 *
 * Run: SUQO_API_KEY=su_test_key_… php create-subscription.php pbp_3n9k2x
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Suqo\Exception\KycRequiredError;
use Suqo\Exception\NetworkError;
use Suqo\Exception\SuqoError;
use Suqo\Exception\ValidationError;
use Suqo\Params\CreateSubscriptionParams;
use Suqo\Params\CustomerBilling;
use Suqo\Params\CustomerInput;
use Suqo\Params\CustomerShipping;
use Suqo\SuqoClient;

$pbpId = $argv[1] ?? 'pbp_3n9k2x';

$suqo = new SuqoClient();

// The SDK says `customer`; the wire says `client`. The rename is applied at the
// serialisation boundary, so error bodies and toArray() say `client`.
$params = new CreateSubscriptionParams(
    pbpId: $pbpId,
    customer: new CustomerInput(
        phone: '9841000100',
        fullName: 'Ram Shrestha',
        email: 'ram@client.com',
        address: 'Kathmandu, Nepal',
        // Write-side billing keeps the billing_ prefix on every field. The read
        // side drops it: you send billingEmail, you read email.
        billing: new CustomerBilling(
            billingBusinessName: 'ABC Pvt Ltd.',
            billingEmail: 'ram@client.com',
            billingAddress: 'Kathmandu, Nepal',
            billingPanVat: '9841000100',
        ),
        shipping: new CustomerShipping(
            phone: '9841000100',
            fullName: 'Ram Shrestha',
            email: 'ram@client.com',
        ),
    ),
    returnUrl: 'https://merchant.example.com/thanks',
);

// toWire() is public: inspect the exact body without making a request.
if (getenv('APP_DEBUG')) {
    fwrite(STDERR, json_encode($params->toWire(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
}

try {
    $created = $suqo->subscriptions->create($params);
} catch (ValidationError $e) {
    // fieldErrors is keyed by WIRE name: pbp_id, client, billing_email, …
    foreach ($e->fieldErrors as $field => $messages) {
        fwrite(STDERR, sprintf("%s: %s\n", $field, implode(', ', $messages)));
    }
    exit(1);
} catch (KycRequiredError $e) {
    // Merchant onboarding is incomplete — not the buyer's fault.
    fwrite(STDERR, 'kyc required: ' . ($e->kycStatus ?? '?') . PHP_EOL);
    exit(1);
} catch (NetworkError $e) {
    // Writes are NOT retried. The subscription may or may not exist. Reconcile
    // against subscriptions->list(); do not blindly resend.
    fwrite(STDERR, "network failure — outcome unknown, req={$e->requestId}\n");
    exit(75);
} catch (SuqoError $e) {
    fwrite(STDERR, sprintf("suqo %d req=%s: %s\n", $e->status, $e->requestId, $e->getMessage()));
    exit(1);
}

// The 201 body is declared as the same schema as the request, so the response
// echoes what was sent. There is no typed checkout URL or subscription id.
printf("created %s  return %s\n", $created->pbpId ?? '-', $created->returnUrl ?? '-');

// Anything the server adds beyond the declared schema is reachable untyped.
$checkoutUrl = $created->toArray()['checkout_url'] ?? null;

if ($checkoutUrl === null) {
    fwrite(STDERR, 'no checkout URL in response: ' . json_encode($created->toArray()) . PHP_EOL);
    exit(1);
}

printf("send the buyer to %s\n", $checkoutUrl);
