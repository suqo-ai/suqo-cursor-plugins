import { SuqoClient } from "@suqo/sdk";

/**
 * Lazy, guarded singleton — construct once, on first real use, not at module
 * load time. Importing this file (e.g. because some unrelated script pulled
 * it in transitively) must never crash just because SUQO_API_KEY isn't set
 * in that context; only calling getSuqoClient() should.
 */
let client: SuqoClient | undefined;

export function getSuqoClient(): SuqoClient {
  if (!client) {
    const apiKey = process.env.SUQO_API_KEY;
    if (!apiKey) {
      throw new Error("SUQO_API_KEY is not set");
    }
    // baseUrl/timeout/maxRetries are all left at their defaults here (inferred
    // from the key, 30s, 2 retries on reads). Construct a second SuqoClient
    // instead of trying to override per-call if one call genuinely needs
    // different settings — there's no per-call override.
    client = new SuqoClient({ apiKey });
  }
  return client;
}
