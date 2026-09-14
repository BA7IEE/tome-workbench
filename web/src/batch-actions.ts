import { onDialogClosed } from "./core";
import { viewDialog, dialog, esc, reload, ApiError } from "./core";
export interface BatchAction {
  label: string;
  run: (key: string) => Promise<unknown>;
}
export function batchActions(title: string, actions: BatchAction[]) {
  const tasks = actions.map((a) => ({
    ...a,
    key: crypto.randomUUID(),
    state: "待执行",
    error: "",
  }));
  let running = false;
  viewDialog(
    title,
    `<p>共${tasks.length}项。逐项执行并保留结果；失败项可以使用原请求重试，成功项不会重复执行。</p><div class="batch-results">${tasks.map((t, n) => `<div data-result="${n}"><span>${esc(t.label)}</span><strong>待执行</strong><small></small></div>`).join("")}</div><div class="button-row"><button class="btn primary" id="batch-start">开始执行</button><span id="batch-summary" role="status"></span></div>`,
  );
  const start = dialog.querySelector<HTMLButtonElement>("#batch-start")!;
  const paint = () => {
    tasks.forEach((t, n) => {
      const row = dialog.querySelector(`[data-result="${n}"]`)!;
      row.querySelector("strong")!.textContent = t.state;
      row.querySelector("small")!.textContent = t.error;
    });
    dialog.querySelector("#batch-summary")!.textContent =
      `完成${tasks.filter((t) => t.state === "已完成").length} / ${tasks.length}`;
  };
  start.addEventListener("click", async () => {
    if (running) return;
    running = true;
    start.disabled = true;
    dialog.querySelector<HTMLButtonElement>(".close")!.disabled = true;
    try {
      for (const t of tasks) {
        if (t.state === "已完成" || t.state === "待核对") continue;
        t.state = "执行中";
        t.error = "";
        paint();
        try {
          const result = await t.run(t.key);
          if (
            typeof result === "object" &&
            result !== null &&
            "conflict" in result &&
            (result as { conflict: boolean }).conflict
          ) {
            t.state = "待核对";
            t.error = "已保护库存，存在冲突，请查看商品记录";
          } else t.state = "已完成";
        } catch (e) {
          t.state =
            e instanceof ApiError && (e.status === 0 || e.status >= 500)
              ? "结果待确认"
              : "失败";
          t.error = (e as Error).message;
        }
        paint();
      }
    } finally {
      running = false;
      dialog.querySelector<HTMLButtonElement>(".close")!.disabled = false;
      start.textContent = "重试未完成项";
      start.disabled = tasks.every(
        (t) => t.state === "已完成" || t.state === "待核对",
      );
    }
  });
  dialog.oncancel = (e) => {
    if (running) e.preventDefault();
  };
  onDialogClosed(() => {
    void reload();
  });
}
