import { catalogContext } from "./catalog-context";
import { safeReturn } from "./record-controls";
import type { Item } from "./types";

export function productReturn(item: Item) {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const origin = safeReturn(qs.get("returnTo"));
  const remembered = catalogContext().listHash;
  const href =
    origin ||
    (item.dataMode === "TEST" &&
    new URLSearchParams(remembered.split("?")[1] || "").get("dataMode") !==
      "TEST"
      ? "#/items?dataMode=TEST"
      : remembered);
  const label = href.startsWith("#/candidates")
    ? "返回本次导入记录"
    : href.startsWith("#/procurement")
      ? "返回采购记录"
      : href.startsWith("#/collections")
        ? "返回客户选品"
        : href.startsWith("#/tasks")
          ? "返回待办"
          : "返回商品列表";
  return { href, label };
}

export function productHref(id: string, origin = "", tab = "") {
  const qs = new URLSearchParams();
  if (tab) qs.set("tab", tab);
  if (safeReturn(origin)) qs.set("returnTo", origin);
  return `#/items/${id}${qs.size ? "?" + qs : ""}`;
}
