import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { WebhookEvent } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js";

/**
 * Fastify's raw-body problem is different from Express's: there's no
 * drop-in `fastify.raw()` middleware. Fastify's built-in JSON content-type
 * parser already consumes and parses the body before any handler runs, and
 * `addContentTypeParser()` overrides that parser for the WHOLE Fastify
 * instance it's called on — the same "mounted globally breaks every other
 * route" mistake the Express template warns against, just via a different
 * mechanism.
 *
 * The fix is Fastify's own encapsulation model: register this route inside
 * its own plugin scope, and an addContentTypeParser() override inside that
 * scope applies ONLY to routes registered in it — the outer app's normal
 * JSON parsing on every other route is untouched. That's what this being a
 * FastifyPluginAsync (registered with `fastify.register(...)`, not a bare
 * route added directly on the root instance) buys you here.
 */
const webhookRoutes: FastifyPluginAsync = async (instance: FastifyInstance) => {
  // Scoped to this plugin instance only — parseAs: "buffer" hands the
  // handler the exact bytes instead of Fastify's own parsed JSON.
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  instance.post(
    "/webhooks/suqo",
    // Same default Express's own express.raw() ships with; Fastify's own
    // default is 1MB, so this tightens it for this route specifically.
    { bodyLimit: 100 * 1024 },
    async (request, reply) => {
      const rawBody = request.body as Buffer;
      const signature = request.headers["x-suqo-signature"];
      const timestamp = request.headers["x-suqo-timestamp"];
      if (typeof signature !== "string" || typeof timestamp !== "string") {
        return reply.code(400).send();
      }

      const secret = process.env.SUQO_WEBHOOK_SECRET;
      if (!secret) {
        // verify() itself handles this fine (returns false, doesn't throw) —
        // checked explicitly anyway so a misconfigured deployment gets a
        // distinct, loud signal instead of blending into bad-signature noise.
        request.log.error("SUQO_WEBHOOK_SECRET is not set");
        return reply.code(500).send();
      }

      const verified = getSuqoClient().webhooks.verify({ rawBody, signature, timestamp, secret });
      if (!verified) {
        return reply.code(400).send();
      }

      // Return 2xx fast, then process out of band.
      void reply.code(200).send();

      // Parse only AFTER verifying. Event payloads stay snake_case on purpose. The
      // 200 already went out, so a parse failure here can only be logged — a
      // verified signature says the bytes came from SUQO, not that they're
      // valid JSON. Fastify does swallow a rejection here without crashing
      // the process, but silently — logging explicitly instead of relying on that.
      let event: WebhookEvent;
      try {
        event = JSON.parse(rawBody.toString("utf8")) as WebhookEvent;
      } catch (err) {
        request.log.error(err, "verified event had an unparseable body");
        return;
      }

      // .catch(), not bare fire-and-forget — an uncaught rejection here would
      // crash the whole process (Node terminates on unhandled rejection by
      // default) over a single bad event, taking down every other in-flight request.
      processEvent(event).catch((err: unknown) => request.log.error(err, "processEvent failed"));
    },
  );
};

async function processEvent(event: WebhookEvent): Promise<void> {
  // Be idempotent — key on subscription_id (or api_key_id for api_key.* events);
  // redelivery is normal, the SDK keeps no replay store of its own.
  switch (event.event) {
    case "checkout.succeeded":
      console.log("checkout succeeded", event.subscription_id, event.amount);
      break;
    case "checkout.failed":
      console.log("checkout failed", event.subscription_id);
      break;
    case "subscription.status_changed":
      console.log(event.subscription_id, event.previous_status, "->", event.current_status);
      break;
    default:
      console.log("unhandled event", event.event);
  }
}

export default webhookRoutes;

// Usage: fastify.register(webhookRoutes) — NOT fastify.post(...) directly on
// the root instance, or the content-type parser override leaks app-wide.
