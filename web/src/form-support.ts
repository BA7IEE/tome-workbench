type Control =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement
  | HTMLButtonElement;
export function lockControls(root: HTMLElement): () => void {
  const controls = [
    ...root.querySelectorAll<Control>("input,select,textarea,button"),
  ].map((el) => [el, el.disabled] as const);
  for (const [el] of controls) el.disabled = true;
  root.setAttribute("aria-busy", "true");
  return () => {
    for (const [el, disabled] of controls) el.disabled = disabled;
    root.removeAttribute("aria-busy");
  };
}
function labelOf(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
) {
  const labelId = el.getAttribute("aria-labelledby");
  if (labelId)
    return document.getElementById(labelId)?.textContent?.trim() || el.name;
  return (
    el.getAttribute("aria-label") ||
    el.labels?.[0]?.querySelector("span")?.textContent?.trim() ||
    el.name ||
    "此项"
  );
}
export function bindFormValidation(
  form: HTMLFormElement,
  error: HTMLElement,
  signal: AbortSignal,
) {
  form.addEventListener(
    "invalid",
    (event) => {
      event.preventDefault();
      const invalid = [
        ...form.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input,select,textarea"),
      ].find((el) => el.willValidate && !el.validity.valid);
      if (!invalid) return;
      const label = labelOf(invalid).replace(/\s*\*$/, "");
      error.textContent = invalid.validity.valueMissing
        ? `请填写“${label}”，再提交。`
        : `请检查“${label}”的格式或取值。`;
      invalid.setAttribute("aria-invalid", "true");
      for (
        let parent = invalid.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      invalid.focus({ preventScroll: true });
      invalid.scrollIntoView({ block: "center", behavior: "auto" });
    },
    { capture: true, signal },
  );
  form.addEventListener(
    "input",
    (event) => {
      const el = event.target as HTMLInputElement;
      if (el.validity?.valid) el.removeAttribute("aria-invalid");
    },
    { signal },
  );
}
