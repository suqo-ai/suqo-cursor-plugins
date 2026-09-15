import type { Page, Product } from "@suqo/sdk";
import { getSuqoClient } from "./suqo-client.js";

// Server default is 20 if omitted; server max is 100. Raise this for fewer
// round-trips, or leave it small to match what a UI table actually shows.
const PAGE_SIZE = 20;

export interface ProductsPageResult {
  products: Product[];
  page: number;
  pageCount: number; // for rendering "page N of M"
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Fetches ONE page of products for a UI paging control (Next/Previous
 * buttons) — manual page/pageSize, not autoPaging(). See
 * references/pagination.md for when to reach for each.
 */
export async function getProductsPage(page: number, pageSize = PAGE_SIZE): Promise<ProductsPageResult> {
  // The `= PAGE_SIZE` default only covers `undefined` — an explicit 0 (or a
  // negative value) would otherwise divide-by-zero below, so it's clamped
  // here regardless of how the caller got there.
  const effectivePageSize = pageSize > 0 ? pageSize : PAGE_SIZE;

  const suqo = getSuqoClient();
  const result: Page<Product> = await suqo.products.list({ page, pageSize: effectivePageSize });

  return {
    products: result.results,
    page,
    pageCount: Math.max(1, Math.ceil(result.count / effectivePageSize)),
    hasNext: result.next !== null,
    hasPrevious: result.previous !== null,
  };
}
