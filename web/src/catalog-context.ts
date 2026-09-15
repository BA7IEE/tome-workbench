import { me } from "./core";
import type { Item } from "./types";
let owner = "",
  listHash = "#/items",
  listScroll = 0,
  filter = "";
let queue: string[] = [];
let browse: string[] = [];
const selected = new Map<string, Item>();
// Presentation controls must not turn the same filter into a new selection scope.
export function catalogFilterScope(query: URLSearchParams) {
  const filters = new URLSearchParams(query);
  for (const key of ["page", "size", "sort", "view"]) filters.delete(key);
  if ((filters.get("dataMode") || "BUSINESS") === "BUSINESS")
    filters.delete("dataMode");
  for (const [key, value] of [...filters]) if (!value) filters.delete(key);
  filters.sort();
  return filters.toString();
}
function account() {
  if (owner !== (me?.id || "")) {
    owner = me?.id || "";
    selected.clear();
    queue = [];
    browse = [];
    listHash = "#/items";
    listScroll = 0;
    filter = "";
  }
}
export function catalogContext() {
  account();
  return { selected, listHash, listScroll, queue, browse };
}
export function rememberBrowseResults(ids: string[]) {
  account();
  browse = [...ids];
}
export function rememberList(hash: string, scope: string, scroll = 0) {
  account();
  if (filter !== scope) selected.clear();
  filter = scope;
  listHash = hash;
  listScroll = scroll;
}
export function saveListScroll() {
  account();
  listScroll = window.scrollY;
}
export function selectItem(item: Item, on: boolean) {
  account();
  if (on) {
    if (!selected.has(item.id) && selected.size >= 100)
      throw new Error("一次最多选择100件，请分批处理");
    selected.set(item.id, item);
  } else selected.delete(item.id);
}
export function beginEditQueue(ids: string[]) {
  account();
  queue = [...new Set(ids)].slice(0, 100);
}
export function clearEditQueue() {
  account();
  queue = [];
}
