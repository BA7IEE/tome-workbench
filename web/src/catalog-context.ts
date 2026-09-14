import { me } from "./core";
import type { Item } from "./types";
let owner = "",
  listHash = "#/items",
  listScroll = 0,
  filter = "";
let queue: string[] = [];
const selected = new Map<string, Item>();
function account() {
  if (owner !== (me?.id || "")) {
    owner = me?.id || "";
    selected.clear();
    queue = [];
    listHash = "#/items";
    listScroll = 0;
    filter = "";
  }
}
export function catalogContext() {
  account();
  return { selected, listHash, listScroll, queue };
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
