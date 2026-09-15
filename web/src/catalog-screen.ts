import { createElement } from "react";
import { request } from "./core";
import { onPageReady } from "./page-lifecycle";
import { catalogContext, rememberList, selectItem } from "./catalog-context";
import { bindCatalogMenus } from "./catalog-menu";
import { bindDictionaryFields } from "./dictionary-picker";
import type { Item } from "./types";
import { mountView } from "./arco/runtime";
import { Catalog } from "./arco/catalog";
export async function catalogScreen() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const filters = new URLSearchParams(qs);
  filters.delete("view");
  const scope = new URLSearchParams(filters);
  for (const k of ["page", "size", "sort"]) scope.delete(k);
  const previous = catalogContext();
  const restoreScroll =
    previous.listHash === location.hash ? previous.listScroll : 0;
  rememberList(location.hash, scope.toString(), restoreScroll);
  const data = await request<{
    rows: Item[];
    total: number;
    page: number;
    size: number;
  }>(`/items?${filters}`);
  for (const row of data.rows)
    if (catalogContext().selected.has(row.id)) selectItem(row, true);
  const root = "catalog-" + crypto.randomUUID();
  onPageReady(root, (el, signal) => {
    mountView(
      el,
      signal,
    )(createElement(Catalog, { data, qs, scope: scope.toString() }));
    bindCatalogMenus(el, signal);
    bindDictionaryFields(
      el.querySelector<HTMLFormElement>("#catalog-search")!,
      signal,
    );
    if (restoreScroll) window.scrollTo(0, restoreScroll);
  });
  return `<div id="${root}" class="catalog-page arco-workspace"></div>`;
}
