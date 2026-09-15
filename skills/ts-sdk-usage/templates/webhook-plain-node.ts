import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WebhookEvent } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js";

const WEBHOOK_PATH = "/webhooks/suqo";
// Same default Express's own express.raw() ships with — there's no framework
// here to enforce this for us, so it has to be done by hand.
const MAX_BODY_BYTES = 100 * 1024;

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Read the raw bytes FIRST — no framework here to accidentally parse them
  // for us, and no size cap either unless we enforce one ourselves.
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch {
    res.writeHead(413).end();
    return;
  }

  const signature = req.headers["x-suqo-signature"];
  const timestamp = req.headers["x-suqo-timestamp"];
  if (typeof signature !== "string" || typeof timestamp !== "string") {
    res.writeHead(400).end();
    return;
  }

  const secret = process.env.SUQO_WEBHOOK_SECRET;
  if (!secret) {
    // verify() itself handles this fine (returns false, doesn't throw) —
    // checked explicitly anyway so a misconfigured deployment gets a
    // distinct, loud signal instead of blending into bad-signature noise.
    console.error("SUQO_WEBHOOK_SECRET is not set");
    res.writeHead(500).end();
    return;
  }

  const verified = getSuqoClient().webhooks.verify({ rawBody, signature, timestamp, secret });

  if (!verified) {
    res.writeHead(400).end();
    return;
  }

  // Return 2xx fast, then process out of band — a slow handler gets retried and duplicated.
  res.writeHead(200).end();

  // Parse only AFTER verifying. Event payloads stay snake_case on purpose. The
  // 200 already went out, so a parse failure here can only be logged, never
  // turned into an error response — a verified signature says the bytes came
  // from SUQO, not that they're valid JSON. Caught in its own try/catch and
  // returned early, rather than let it reject handleWebhook's promise and
  // reach the outer .catch() below, which has no response left to send.
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as WebhookEvent;
  } catch (err) {
    console.error("verified event had an unparseable body:", err);
    return;
  }

  // .catch(), not bare fire-and-forget — an uncaught rejection here would
  // crash the whole process (Node terminates on unhandled rejection by
  // default) over a single bad event, taking down every other in-flight request.
  processEvent(event).catch((err: unknown) => console.error("processEvent failed:", err));
}

async function processEvent(event: WebhookEvent): Promise<void> {
  // Be idempotent — key on subscription_id (or the api_key_id for api_key.* events);
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

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === WEBHOOK_PATH) {
    handleWebhook(req, res).catch((err: unknown) => {
      console.error(err);
      // A response may already have gone out (e.g. the 200 before an
      // out-of-band failure) — writeHead() on a headers-already-sent
      // response throws ERR_HTTP_HEADERS_SENT, which would otherwise
      // become a second, truly unhandled rejection right here.
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(3000);
