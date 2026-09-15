import { getSuqoClient } from "./suqo-client.js";

/**
 * Walks every product with autoPaging (follows `next` until exhausted) down to
 * each billing period's pbpId — the id subscriptions.create() expects.
 */
async function main(): Promise<void> {
  const suqo = getSuqoClient();

  // pageSize: 100 is the server's documented max — fewer round-trips than
  // leaving it at the default page size of 20.
  for await (const product of suqo.products.autoPaging({ pageSize: 100 })) {
    console.log(`${product.name} (${product.productId})`);

    for (const plan of product.plan) {
      for (const period of plan.billingPeriods) {
        // price/currency/pbpId are printed as-is — price is a decimal-shaped
        // string ("500.00") and must never be coerced to `number`.
        console.log(
          `  ${plan.planName} — ${period.label}: ${period.price} ${period.currency} (pbpId: ${period.pbpId})`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
