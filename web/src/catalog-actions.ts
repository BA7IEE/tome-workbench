import { exportMaterials } from "./materials";
import { bulkEdit } from "./bulk-edit";
import { deleteProducts } from "./recycle-bin";
import {
  request,
  can,
  form,
  note,
  check,
  esc,
} from "./core";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Item } from "./types";
export type CatalogAction = {
  label: string;
  run: () => unknown;
  danger?: boolean;
  primary?: boolean;
};
async function bulkApprove(items: Item[]) {
  const result = await request<{
    rows: {
      id: string;
      version?: number;
      ready: boolean;
      missing: { code: string; title: string }[];
    }[];
    ready: number;
    blocked: number;
  }>("/items/approvals/readiness", "POST", {
    items: items.map((item) => ({ id: item.id, version: item.version })),
  });
  const ready = result.rows.filter(
    (row): row is typeof row & { version: number } =>
      row.ready && typeof row.version === "number",
  );
  if (!ready.length)
    throw new Error("所选商品当前都不能批准，请先处理预检阻断项");
  const names = new Map(items.map((item) => [item.id, item]));
  form(
    "批量确认当前资料",
    note(
      `已选 ${items.length} 件：${ready.length} 件可批准，${result.blocked} 件被阻断。确认资料不会自动上架；未通过预检的商品保持原样。`,
    ) +
      `<ul>${result.rows
        .filter((row) => !row.ready)
        .map((row) => {
          const item = names.get(row.id);
          return `<li>${esc(item ? `${item.code} ${item.title}` : row.id)}：${esc(row.missing.map((missing) => missing.title).join("；"))}</li>`;
        })
        .join("")}</ul>` +
      check("confirmed", `我已核对并确认批准这 ${ready.length} 件商品`),
    async (data) => {
      if (!data.has("confirmed")) throw new Error("请先确认预检结果");
      setTimeout(
        () =>
          batchActions(
            "批量批准结果",
            ready.map((row) => {
              const item = names.get(row.id)!;
              return {
                label: `${item.code} ${item.title}`,
                run: (key: string) =>
                  request(
                    `/items/${item.id}/approve`,
                    "POST",
                    { version: row.version },
                    key,
                  ),
              };
            }),
          ),
        0,
      );
      return { nextStep: true };
    },
    `确认批准 ${ready.length} 件`,
  );
}
export function catalogActions(chosen: () => Item[]): CatalogAction[] {
  const actions: CatalogAction[] = [{
    label: "下载商品资料", primary: true, run: () => exportMaterials(chosen()),
  }];
  if (can("edit")) actions.push({
    label: "批量编辑", primary: true, run: () => bulkEdit(chosen()),
  });
  if (can("review") && chosen().some(item => !item.approvedValid)) actions.push({
    label: "确认商品资料", primary: true, run: () => bulkApprove(chosen()),
  });
  if (can("delete")) actions.push({
    label: "删除所选", danger: true, run: () => deleteProducts(chosen()),
  });
  return actions;
}
