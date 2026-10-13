import type { Item } from "./types";
import { productEditHref } from "./product-navigation";
/** Standard single-item and sequential editing use exactly the same page. */
export function editProduct(item: Item) {
  location.hash = productEditHref(item.id);
}
