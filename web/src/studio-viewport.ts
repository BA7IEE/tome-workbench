/** Safari may shrink its visual viewport without shrinking the layout viewport. */
export function viewportBottomInset(layoutHeight: number, visibleHeight: number, offsetTop: number) {
  if (![layoutHeight, visibleHeight, offsetTop].every(Number.isFinite) || visibleHeight <= 0)
    return 0;
  return Math.round(Math.max(0, layoutHeight - visibleHeight - Math.max(0, offsetTop)));
}
export function alignStudioViewport(root: HTMLElement, signal: AbortSignal) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const place = () => root.style.setProperty("--studio-viewport-inset", `${viewportBottomInset(innerHeight, viewport.height, viewport.offsetTop)}px`);
  viewport.addEventListener("resize", place, { signal });
  viewport.addEventListener("scroll", place, { signal });
  window.addEventListener("resize", place, { signal });
  place();
  signal.addEventListener("abort", () => root.style.removeProperty("--studio-viewport-inset"), { once: true });
}
