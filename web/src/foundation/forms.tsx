import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Input, ProForm } from "./components";
import { ToMeProvider } from "./provider";

/** Enhance text presentation before controllers bind; native FormData remains authoritative. */
export function mountFormControls(container: HTMLElement, signal: AbortSignal) {
  if (signal.aborted) return;
  for (const original of container.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >(".field input, .field textarea")) {
    if (original.classList.contains("ant-input")) continue;
    const multiline = original instanceof HTMLTextAreaElement;
    if (
      !multiline &&
      !["text", "email", "password", "search", "url", "tel"].includes(
        (original as HTMLInputElement).type,
      )
    )
      continue; // File/date/number/checkbox and dictionary selects retain native contracts.
    const props: Record<string, unknown> = { defaultValue: original.value };
    const names: Record<string, string> = {
      class: "className",
      autocomplete: "autoComplete",
      inputmode: "inputMode",
      maxlength: "maxLength",
      minlength: "minLength",
      tabindex: "tabIndex",
      readonly: "readOnly",
      spellcheck: "spellCheck",
      autofocus: "autoFocus",
    };
    for (const { name, value } of original.attributes) {
      if (name === "value" || name === "style" || name === "size") continue;
      props[names[name] || name] = [
        "required",
        "readonly",
        "disabled",
        "autofocus",
      ].includes(name)
        ? true
        : value;
    }
    if (original.getAttribute("style")) {
      const style: Record<string, string> = {};
      for (const property of original.style) {
        const key = property.startsWith("--")
          ? property
          : property.replace(/-([a-z])/g, (_, letter: string) =>
              letter.toUpperCase(),
            );
        style[key] = original.style.getPropertyValue(property);
      }
      props.style = style;
    }
    if (!multiline && original.hasAttribute("size"))
      props.htmlSize = Number(original.getAttribute("size"));
    const host = document.createElement("span");
    host.className = "foundation-native-field";
    original.replaceWith(host);
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <ToMeProvider>
          <ProForm.Item noStyle>
            {multiline ? <Input.TextArea {...props} /> : <Input {...props} />}
          </ProForm.Item>
        </ToMeProvider>,
      ),
    );
    signal.addEventListener("abort", () => root.unmount(), { once: true });
  }
}
