<?php

/**
 * PSR-15 middleware that verifies a SUQO webhook before the handler runs.
 * Works with Slim, Mezzio, or any PSR-15 stack.
 *
 * Attach it to the webhook route only:
 *
 *   $app->post('/webhooks/suqo', SuqoWebhookHandler::class)
 *       ->add(new VerifySuqoWebhook($secret, $responseFactory));
 *
 * On success the verified raw body is put on the request as the
 * "suqo.raw_body" attribute, so the handler never has to re-read the stream.
 */

declare(strict_types=1);

namespace App\Middleware;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Suqo\Webhook;

final class VerifySuqoWebhook implements MiddlewareInterface
{
    public function __construct(
        private readonly string $secret,
        private readonly ResponseFactoryInterface $responseFactory,
        private readonly int $maxAge = 300,
    ) {
    }

    public function process(
        ServerRequestInterface $request,
        RequestHandlerInterface $handler,
    ): ResponseInterface {
        $stream = $request->getBody();

        // The stream may already have been read further up the stack.
        if ($stream->isSeekable()) {
            $stream->rewind();
        }

        // Raw bytes. Re-serialising a parsed body will never verify.
        $raw = (string) $stream;

        if ($stream->isSeekable()) {
            $stream->rewind();
        }

        // Never throws; false on every failure path.
        $verified = Webhook::verify(
            rawBody: $raw,
            signature: $request->getHeaderLine('X-Suqo-Signature') ?: null,
            timestamp: $request->getHeaderLine('X-Suqo-Timestamp') ?: null,
            secret: $this->secret,
            maxAge: $this->maxAge,
        );

        if (!$verified) {
            // No detail in the body — which check failed stays in our logs.
            return $this->responseFactory->createResponse(400);
        }

        return $handler->handle($request->withAttribute('suqo.raw_body', $raw));
    }
}
