import type { Item } from "./types";
/** Standard single-item and sequential editing use exactly the same page. */
export function editProduct(item: Item) {
  location.hash = `/items/${item.id}/edit`;
}
