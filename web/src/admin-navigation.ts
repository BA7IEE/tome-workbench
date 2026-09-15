import { can, esc } from "./core";
type Entry = [string, string, string];
const sections: { name: string; compact?: boolean; items: Entry[] }[] = [
  {
    name: "日常工作",
    items: [
      ["items", "商品库", "read"],
      ["candidates", "待确认", "read"],
      ["tasks", "经营待办", "read"],
    ],
  },
  {
    name: "销售",
    compact: true,
    items: [
      ["listings", "发布记录", "read"],
      ["inquiries", "客户询盘", "sell"],
      ["sales", "成交记录", "finance"],
      ["collections", "客户选品", "read"],
    ],
  },
  {
    name: "资源",
    compact: true,
    items: [
      ["procurement", "采购历史", "supply"],
      ["sources", "货源与供应商", "supply"],
      ["intake", "批量图片归档", "edit"],
    ],
  },
  {
    name: "系统",
    compact: true,
    items: [
      ["dashboard", "工作总览", "read"],
      ["dictionaries", "字典管理", "dictionary"],
      ["settlements", "合作对账", "finance"],
      ["settings", "设置与账户", "read"],
      ["operations", "运行状态", "users"],
      ["audit", "操作记录", "audit"],
      ["jobs", "失败任务", "users"],
    ],
  },
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
export const pageNames = Object.fromEntries(
  sections.flatMap((section) =>
    section.items.map(([key, label]) => [key, label]),
  ),
);

export function navigation(page: string) {
  const rows = [
    [
      "items?view=grid&status=AVAILABLE",
      "商品库",
      page === "items" || page === "trash",
    ],
    ["imports", "导入记录", page === "imports" || page === "candidates"],
    [
      "settings",
      "设置",
      !["items", "trash", "imports", "candidates"].includes(page),
    ],
  ] as const;
  return `<div class="library-navigation">${rows.map(([path, label, active]) => `<a href="#/${path}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div>`;
}
