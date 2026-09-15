export function placeStudioSections(form: HTMLFormElement) {
  const fields = form.querySelector(".entry-fields")!;
  const media = fields.querySelector("[data-media-slot]")!;
  const photos = form.querySelector(".entry-photos"),
    existing = form.querySelector(".entry-existing-media");
  if (photos) {
    media.append(photos);
    if (existing) photos.querySelector(".entry-drop")!.before(existing);
  }
  const source = form.querySelector(".entry-source");
  if (source) {
    const holder = fields.querySelector("[data-source-slot]")!,
      details = document.createElement("details");
    details.className = "studio-card studio-optional";
    details.dataset.section = "supply";
    details.innerHTML =
      '<summary>货源与实物</summary><div class="studio-optional-body"></div>';
    const body = details.lastElementChild!;
    while (source.firstChild) body.append(source.firstChild);
    body.querySelector("h2")?.remove();
    holder.append(details);
    source.remove();
  }
  const review = form.querySelector(".entry-review");
  if (review) {
    review.className = "studio-card studio-inline-review";
    (
      fields.querySelector(
        "[data-section=authentication] .studio-optional-body",
      ) || fields.querySelector("[data-review-slot]")!
    ).append(review);
  }
}
export function focusStudioField(form: HTMLFormElement, name: string) {
  const selectors: Record<string, string> = {
    images: ".entry-photos",
    brand: '[data-dictionary="BRAND"] .dictionary-input',
    title: "[name=title]",
    price: "[name=price]",
    condition: "[name=condition]",
    measurements: "[name=measurements]",
    authentication: "[name=authStatus]",
    english: "[name=descriptionEn]",
    copy: "[name=descriptionZh]",
    supply: "[data-section=supply]",
    availability: "[data-stock-controls]",
  };
  const target = form.querySelector<HTMLElement>(
    selectors[name] || `[name="${CSS.escape(name)}"]`,
  );
  if (!target) return;
  for (let p: HTMLElement | null = target; p; p = p.parentElement)
    if (p instanceof HTMLDetailsElement) p.open = true;
  target.scrollIntoView({ block: "center", behavior: "instant" });
  (target.querySelector<HTMLElement>("input,textarea,select") || target).focus({
    preventScroll: true,
  });
  target.classList.add("studio-highlight");
  setTimeout(() => target.classList.remove("studio-highlight"), 1400);
}
