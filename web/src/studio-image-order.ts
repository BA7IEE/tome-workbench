import { esc } from "./core";
export function imageOrder(
  ids: string[],
  photos: { id: string; originalName: string }[],
) {
  return ids
    .map((id, n) => {
      const name =
        photos.find((p) => p.id === id)?.originalName || "待核对图片";
      return `<div class="studio-order-row" data-order-id="${id}" draggable="true"><img class="record-thumb" src="/api/assets/${id}/preview" alt="${esc(name)}"><span>${n + 1}. ${esc(name)}</span><button type="button" class="btn subtle" data-studio-up="${id}" aria-label="上移 ${esc(name)}" ${n === 0 ? "disabled" : ""}>上移</button><button type="button" class="btn subtle" data-studio-down="${id}" aria-label="下移 ${esc(name)}" ${n === ids.length - 1 ? "disabled" : ""}>下移</button><label>移到第 <select data-order-position="${id}" aria-label="移动 ${esc(name)} 到第几位">${ids.map((_, position) => `<option value="${position}" ${n === position ? "selected" : ""}>${position + 1}</option>`).join("")}</select> 位</label></div>`;
    })
    .join("");
}
export function bindImageOrder(
  host: HTMLElement,
  ids: () => string[],
  changed: () => void,
  locked: () => boolean,
) {
  let dragged = "";
  const move = (id: string, to: number, focus: string) => {
    if (locked()) return;
    const list = ids(),
      from = list.indexOf(id);
    if (from < 0 || to < 0 || to >= list.length || to === from) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    changed();
    const row = host.querySelector<HTMLElement>(
      `[data-order-id="${CSS.escape(id)}"]`,
    );
    const target = row?.querySelector<HTMLElement>(focus);
    if (target instanceof HTMLButtonElement && target.disabled)
      row?.querySelector<HTMLSelectElement>("select")?.focus();
    else target?.focus();
  };
  host.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-studio-up], [data-studio-down]",
    );
    if (!button || button.disabled) return;
    const id = button.dataset.studioUp || button.dataset.studioDown!;
    move(
      id,
      ids().indexOf(id) + (button.dataset.studioUp ? -1 : 1),
      button.dataset.studioUp ? "[data-studio-up]" : "[data-studio-down]",
    );
  });
  host.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.dataset.orderPosition)
      move(select.dataset.orderPosition, Number(select.value), "select");
  });
  host.addEventListener("dragstart", (event) => {
    if (locked()) {
      event.preventDefault();
      return;
    }
    dragged =
      (event.target as Element).closest<HTMLElement>("[data-order-id]")?.dataset
        .orderId || "";
    event.dataTransfer?.setData("text/plain", dragged);
  });
  host.addEventListener("dragover", (event) => {
    if (dragged && !locked()) event.preventDefault();
  });
  host.addEventListener("drop", (event) => {
    event.preventDefault();
    const to = (event.target as Element).closest<HTMLElement>("[data-order-id]")
      ?.dataset.orderId;
    if (dragged && to) move(dragged, ids().indexOf(to), "select");
    dragged = "";
  });
  host.addEventListener("dragend", () => {
    dragged = "";
  });
}
