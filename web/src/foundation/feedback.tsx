import { Alert } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ToMeProvider } from "./provider";
import { designTokens } from "./tokens";

const roots = new WeakMap<HTMLElement, Root>();
/** The existing toast controller retains timing and error text; Foundation owns display. */
export function renderFeedback(
  host: HTMLElement,
  text: string,
  error: boolean,
) {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  host.setAttribute("role", error ? "alert" : "status");
  host.setAttribute("aria-live", error ? "assertive" : "polite");
  flushSync(() =>
    root!.render(
      <ToMeProvider>
        <Alert
          className="foundation-feedback"
          role="presentation"
          showIcon
          type={error ? "error" : "success"}
          message={text}
          style={{
            color: error ? designTokens.errorText : designTokens.successText,
            background: error ? designTokens.errorBg : designTokens.successBg,
            borderColor: designTokens.border,
          }}
        />
      </ToMeProvider>,
    ),
  );
}
