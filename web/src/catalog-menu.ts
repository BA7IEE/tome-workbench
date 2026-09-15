// Keep row actions outside the scrolling table's clipping rectangle.
export function bindCatalogMenus(root: HTMLElement, signal: AbortSignal) {
  const menus = Array.from(
    root.querySelectorAll<HTMLDetailsElement>(
      "details.catalog-row-menu, .bulk-more, .page-actions-menu",
    ),
  );
  const close = (except?: HTMLDetailsElement) => {
    for (const menu of menus) if (menu !== except) menu.open = false;
  };
  for (const menu of menus) {
    menu.addEventListener(
      "toggle",
      () => {
        if (!menu.open) return;
        close(menu);
        if (!menu.classList.contains("catalog-row-menu")) return;
        const summary = menu.querySelector("summary")!;
        const panel = menu.querySelector<HTMLElement>(":scope > div")!;
        const rect = summary.getBoundingClientRect();
        const width = panel.offsetWidth,
          height = panel.offsetHeight;
        const top =
          rect.bottom + 6 + height <= innerHeight - 8
            ? rect.bottom + 6
            : Math.max(8, rect.top - height - 6);
        panel.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
        panel.style.top = `${top}px`;
      },
      { signal },
    );
  }
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element;
      const menu = target.closest<HTMLDetailsElement>(
        "details.catalog-row-menu, .bulk-more, .page-actions-menu",
      );
      close(menu || undefined);
      if (menu && target.closest("button,a")) menu.open = false;
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      const open = menus.find((menu) => menu.open);
      if (!open) return;
      event.preventDefault();
      close();
      open.querySelector("summary")?.focus();
    },
    { signal },
  );
  window.addEventListener("resize", () => close(), { signal });
  document.addEventListener("scroll", () => close(), { capture: true, signal });
}
