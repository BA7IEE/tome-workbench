import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ToMeProvider } from "../foundation/provider";

/** Each root owns only its own children. Abort it with the page lifecycle. */
export function mountView(host: HTMLElement, signal: AbortSignal) {
  const root = createRoot(host);
  const render = (children: ReactNode) => {
    if (!signal.aborted)
      flushSync(() => root.render(<ToMeProvider>{children}</ToMeProvider>));
  };
  signal.addEventListener("abort", () => root.unmount(), { once: true });
  return render;
}

/** Isolated DOM owned by an existing domain controller, never reconciled by React. */
export const ControllerSlot = memo(function ControllerSlot({
  html = "",
  ...props
}: {
  html?: string;
  className?: string;
  id?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current!.innerHTML = html;
  }, [html]);
  return <div {...props} ref={host} />;
});
