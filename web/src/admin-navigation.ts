import { can, esc } from "./core";
type Entry = [string, string, string];
const sections: { name: string; compact?: boolean; items: Entry[] }[] = [
  { name: "商品与来源", items: [
    ["dashboard", "待处理事项", "read"], ["imports", "导入批次记录", "read"],
    ["sources", "货源与供应商", "supply"], ["procurement", "采购来源记录", "supply"],
    ["intake", "批量补图", "edit"], ["trash", "回收站", "delete"],
  ] },
  { name: "销售记录与客户资料", items: [
    ["sales", "成交记录", "sell"], ["inquiries", "客户跟进", "sell"],
    ["collections", "客户资料包", "read"], ["listings", "渠道身份记录", "read"],
  ] },
  { name: "管理与历史", compact: true, items: [
    ["dictionaries", "标准选项管理", "dictionary"],
    ["financial-history", "历史账务（只读）", "finance"],
    ["operations", "运行状态", "users"], ["audit", "操作记录", "audit"],
    ["jobs", "后台失败任务", "users"],
  ] },
];
export function extraNavigation(page: string) {
  return sections
    .map((section) => {
      const entries = section.items.filter(([, , permission]) =>
        can(permission),
      );
      if (!entries.length) return "";
      const links = entries
        .map(
          ([key, label]) =>
            `<a href="#/${key}" class="${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${esc(label)}</a>`,
        )
        .join("");
      return section.compact
        ? `<details class="nav-group" ${entries.some(([key]) => key === page) ? "open" : ""}><summary>${section.name}</summary><div>${links}</div></details>`
        : `<div class="nav-group"><div class="nav-label">${section.name}</div>${links}</div>`;
    })
    .join("");
}
export const pageNames = Object.fromEntries([
  ...sections.flatMap((section) =>
    section.items.map(([key, label]) => [key, label]),
  ),
  ["imports", "导入记录"],
  ["settings", "设置"], ["items", "商品"], ["distribution", "上架"], ["candidates", "确认导入"], ["settlements", "历史对账快照"],
]);

export function primaryNavigation(page: string) {
  const rows: [string, string, boolean][] = [
    ["items?view=grid", "商品", page === "items" || page === "trash"],
    ["candidates", "导入", page === "imports" || page === "candidates"],
    ...(can("publish") ? [["distribution", "上架", page === "distribution"] as [string, string, boolean]] : []),
    ["settings", "设置", !["items", "trash", "imports", "candidates", "distribution"].includes(page)],
  ];
  return rows.map(([path, label, active]) => ({ path, label, active }));
}
