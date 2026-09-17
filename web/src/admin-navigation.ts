import { can, esc } from "./core";
type Entry = [string, string, string];
const sections: { name: string; compact?: boolean; items: Entry[] }[] = [
  {
    name: "日常工作",
    items: [
      ["dashboard", "工作台", "read"],
      ["items", "商品库", "read"],
      ["candidates", "待确认", "read"],
      ["tasks", "经营待办", "read"],
    ],
  },
  {
    name: "销售",
    compact: true,
    items: [
      ["inquiries", "客户询盘", "sell"],
      ["sales", "成交记录", "sell"],
      ["listings", "远端身份记录", "read"],
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
      ["dictionaries", "字典管理", "dictionary"],
      ["settlements", "合作对账", "finance"],
      ["settings", "更多与账户", "read"],
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
export const pageNames = Object.fromEntries([
  ...sections.flatMap((section) =>
    section.items.map(([key, label]) => [key, label]),
  ),
  ["imports", "导入记录"],
]);

export function navigation(page: string) {
  const rows: [string, string, boolean][] = [
    ["dashboard", "工作台", page === "dashboard"],
    [
      "items?view=grid&status=AVAILABLE",
      "商品库",
      page === "items" || page === "trash",
    ],
    ["imports", "导入记录", page === "imports" || page === "candidates"],
    ...(can("publish")
      ? [
          ["distribution", "商品分发", page === "distribution"] as [
            string,
            string,
            boolean,
          ],
        ]
      : []),
    ...(can("sell")
      ? [
          ["sales", "销售", page === "sales" || page === "inquiries"] as [
            string,
            string,
            boolean,
          ],
        ]
      : []),
    [
      "settings",
      "更多",
      ![
        "dashboard",
        "items",
        "trash",
        "imports",
        "candidates",
        "sales",
        "inquiries",
        "distribution",
      ].includes(page),
    ],
  ];
  return `<div class="library-navigation">${rows.map(([path, label, active]) => `<a href="#/${path}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div>`;
}
