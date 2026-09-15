// Native secondary menus share close and keyboard recovery. Arco owns row menus.
export function bindCatalogMenus(root: HTMLElement, signal: AbortSignal) {
  const menus = Array.from(
    root.querySelectorAll<HTMLDetailsElement>(".bulk-more, .page-actions-menu"),
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
      },
      { signal },
    );
  }
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element;
      const menu = target.closest<HTMLDetailsElement>(
        ".bulk-more, .page-actions-menu",
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
