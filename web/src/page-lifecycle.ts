type Hook = (element: HTMLElement, signal: AbortSignal) => void;
const hooks = new Map<string, Hook>();
let active: AbortController | null = null;
let guard: (() => boolean) | null = null;
export function onPageReady(id: string, hook: Hook) {
  hooks.set(id, hook);
}
export function runPageHooks() {
  active?.abort();
  active = new AbortController();
  guard = null;
  for (const [id, hook] of hooks) {
    const el = document.getElementById(id);
    if (el) hook(el, active.signal);
  }
  hooks.clear();
}
export function setLeaveGuard(fn: (() => boolean) | null) {
  guard = fn;
}
export function canLeavePage() {
  return guard ? guard() : true;
}
