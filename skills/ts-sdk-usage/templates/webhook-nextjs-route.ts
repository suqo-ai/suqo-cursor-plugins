// Next.js App Router route handler — place this file at
// app/api/webhooks/suqo/route.ts. It will NOT be a sibling of suqo-client.ts
// at that location, so adjust the import below to wherever you keep the
// shared client (e.g. "@/lib/suqo-client" if that's aliased, or a relative
// path like "../../../../lib/suqo-client.js").
import type { WebhookEvent } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js"; // <- adjust this path, see above

// Same default Express's own express.raw() ships with.
const MAX_BODY_BYTES = 100 * 1024;

/** Reads the request body as text, aborting once it exceeds maxBytes rather than buffering it all first. */
async function readRawTextCapped(req: Request, maxBytes: number): Promise<string> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new Error("Payload too large");
  }
  if (!req.body) {
    return "";
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Payload too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export async function POST(req: Request): Promise<Response> {
  // Read the raw text FIRST — before anything (req.json()) would parse and discard it.
  let rawBody: string;
  try {
    rawBody = await readRawTextCapped(req, MAX_BODY_BYTES);
  } catch {
    return new Response(null, { status: 413 });
  }

  const signature = req.headers.get("x-suqo-signature");
  const timestamp = req.headers.get("x-suqo-timestamp");
  if (!signature || !timestamp) {
    return new Response(null, { status: 400 });
  }

  const secret = process.env.SUQO_WEBHOOK_SECRET;
  if (!secret) {
    // verify() itself handles this fine (returns false, doesn't throw) —
    // checked explicitly anyway so a misconfigured deployment gets a
    // distinct, loud signal instead of blending into bad-signature noise.
    console.error("SUQO_WEBHOOK_SECRET is not set");
    return new Response(null, { status: 500 });
  }

  const verified = getSuqoClient().webhooks.verify({ rawBody, signature, timestamp, secret });

  if (!verified) {
    return new Response(null, { status: 400 });
  }

  // Parse only AFTER verifying. Event payloads stay snake_case on purpose. A
  // verified signature says the bytes came from SUQO, not that they're valid
  // JSON — caught explicitly here (unlike the other three templates, no
  // response has been sent yet at this point, so a real 400 is still
  // possible, instead of leaving it to become a generic 500).
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch (err) {
    console.error("verified event had an unparseable body:", err);
    return new Response(null, { status: 400 });
  }

  // Awaited, unlike the plain-Node/Express templates' fire-and-forget: on a
  // serverless/edge runtime (e.g. Vercel), the function can be frozen the
  // instant this handler returns, silently dropping unawaited work. A
  // long-running Node/Express server doesn't have that problem, so it can
  // return the 2xx first. If processEvent() ever becomes slow, reach for a
  // queue or Next.js's `after()` (or the platform's own waitUntil) instead
  // of going back to fire-and-forget here.
  await processEvent(event);

  return new Response(null, { status: 200 });
}

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
