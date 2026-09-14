import { me } from "./core";
let owner = "";
const scrolls = new Map<string, number>();
function account() {
  if (owner !== me?.id) {
    owner = me?.id || "";
    scrolls.clear();
  }
}
export function saveRoutePosition(hash: string) {
  account();
  scrolls.set(hash, window.scrollY);
  if (scrolls.size > 80) scrolls.delete(scrolls.keys().next().value!);
}
export function restoreRoutePosition(hash: string) {
  account();
  const top = scrolls.get(hash);
  if (top !== undefined) window.scrollTo(0, top);
}
