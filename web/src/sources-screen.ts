import {
  request,
  can,
  esc,
  button,
  field,
  area,
  text,
  form,
  note,
  section,
  table,
  viewDialog,
  itemLink,
  code,
} from "./core";
import type { Source, Supplier } from "./types";
import { createItem } from "./items";
import { singleSource, importSources } from "./source-import";
import { quickIntake } from "./quick-intake";
import { sourceLabels, sourceValues } from "./source-fields";
const sourceDisplayLabels: Record<string, string> = {
  ...sourceLabels,
  material: "材质成分 / 细节",
  sizeLabel: "标签尺码",
  measurements: "实测尺寸",
  measurementSource: "尺寸来源",
  condition: "瑕疵与使用痕迹",
};
import { onPageReady } from "./page-lifecycle";
import { batchActions } from "./batch-actions";
export async function sourcesScreen() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    page = Math.max(1, Number(qs.get("page") || 1)),
    q = qs.get("q") || "",
    stage = qs.get("stage") || "";
  const [result, suppliers] = await Promise.all([
    request<{ rows: Source[]; total: number; page: number; size: number }>(
      `/supply/sources?page=${page}&q=${encodeURIComponent(q)}&stage=${encodeURIComponent(stage)}`,
    ),
    request<Supplier[]>("/supply/suppliers"),
  ]);
  const sources = result.rows,
    root = "sources-" + crypto.randomUUID();
  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    location.hash = "/sources?" + next;
  };
  const show = (s: Source) => {
    const values =
      s.payload && typeof s.payload === "object"
        ? (s.payload as Record<string, unknown>)
        : { notes: String(s.payload || "") };
    viewDialog(
      s.title,
      `<dl class="details">${Object.entries(values)
        .map(
          ([k, v]) =>
            `<div><dt>${esc(sourceDisplayLabels[k] || k)}</dt><dd>${esc(typeof v === "object" ? "此字段为结构化资料，保留在原始记录中" : v)}</dd></div>`,
        )
        .join("")}</dl>` + note("原始资料保留，不自动当作已核对事实。"),
    );
  };
  const rows = sources
    .map(
      (s) =>
        `<tr data-source-id="${s.id}" data-search="${esc((s.title + " " + s.sourceKey + " " + (s.supplier?.name || "")).toLowerCase())}"><td>${!s.items.length && can("edit") ? `<input type="checkbox" data-select-source="${s.id}" aria-label="选择货源 ${esc(s.title)}">` : ""}</td><td><div class="table-product">${s.previewUrl ? `<img class="record-thumb" src="${esc(s.previewUrl)}" alt="${esc(s.title)}">` : ""}<div><strong>${esc(s.title)}</strong><small>${esc(s.originalKey || "原货号未填写")}</small><details class="technical-details"><summary>技术标识</summary>${esc(s.sourceKey)}</details></div></div></td><td>${esc(s.sourceLabel || s.supplier?.name || "手工货源")}</td><td>${s.items.length ? '<span class="status-pill good">已接手</span>' : '<span class="status-pill muted">待选品</span>'}</td><td><div class="button-row compact">${button("查看资料", () => show(s))}${s.items.length ? s.items.map((i) => itemLink(i.id, code(i.serial))).join(" ") : can("edit") ? button("接手建档", () => createItem(s)) : ""}</div></td></tr>`,
    )
    .join("");
  onPageReady(root, (el, signal) => {
    el.querySelector("#source-search-form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget as HTMLFormElement);
        go({
          q: String(d.get("q") || ""),
          stage: String(d.get("stage") || ""),
          page: "",
        });
      },
      { signal },
    );
    el.querySelector("#adopt-selection")?.addEventListener(
      "click",
      () => {
        const ids = [
            ...el.querySelectorAll<HTMLInputElement>(
              "[data-select-source]:checked",
            ),
          ].map((e) => e.dataset.selectSource),
          chosen = sources.filter((s) => ids.includes(s.id) && !s.items.length);
        if (!chosen.length) {
          viewDialog(
            "还没有选择货源",
            note("先勾选要经营的货源，再批量建立商品档案。"),
          );
          return;
        }
        if (chosen.length > 100) {
          viewDialog("请分批操作", note("每次最多接手100件货源。"));
          return;
        }
        batchActions(
          "接手所选货源",
          chosen.map((s) => ({
            label: s.title,
            run: (key) => request("/items", "POST", sourceValues(s), key),
          })),
        );
      },
      { signal },
    );
  });
  return (
    `<div id="${root}"><div class="page-title"><div><h1>货源与供应商</h1><p>维护供应商持有、寄售或远端货源；已接手商品在TM中经营，外部Agent资料统一到待确认处理。</p></div><div class="button-row">${can("edit") ? button("＋ 快速录入我方现货", () => quickIntake()) : ""}<a class="btn primary" href="#/candidates">外部批量接收</a>${button("＋ 记录货源", () => singleSource(suppliers), "")}${button("导入表格", () => importSources(suppliers))}</div></div>` +
    section(
      "货源池",
      `<form class="filters" id="source-search-form"><input name="q" id="source-search" aria-label="搜索全部货源" placeholder="搜索名称、原货号、供货方" value="${esc(q)}"><select name="stage" aria-label="货源阶段"><option value="">全部阶段</option><option value="pending" ${stage === "pending" ? "selected" : ""}>待选品</option><option value="adopted" ${stage === "adopted" ? "selected" : ""}>已接手</option></select><button class="btn primary">搜索</button><span>共 ${result.total} 条 · 第 ${page} 页</span></form><div class="button-row">${can("edit") ? '<button class="btn" id="adopt-selection">为勾选货源建档</button>' : ""}</div>` +
        (sources.length
          ? `<div class="table-wrap"><table><thead><tr><th>选择</th><th>商品 / 原编号</th><th>供货方</th><th>阶段</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : '<div class="empty"><h3>先记录一件货源，或导入已有表格</h3><p>品牌、原货号、报价、备注直接填写，不需要准备技术格式。</p></div>'),
    ) +
    `<div class="pagination"><span>每页50条</span>${page > 1 ? button("上一页", () => go({ page: String(page - 1) })) : ""}${page * 50 < result.total ? button("下一页", () => go({ page: String(page + 1) })) : ""}</div>` +
    section(
      "供应商",
      table(
        ["名称", "联系信息", "备注"],
        suppliers.map((s) => [esc(s.name), esc(s.contact), esc(s.notes)]),
      ),
      button("＋ 新增供应商", () =>
        form(
          "新增供应商",
          field("name", "名称", "", "text", true) +
            field("contact", "联系方式（仅内部）") +
            area("notes", "合作说明", "", 3),
          (d, k) =>
            request(
              "/supply/suppliers",
              "POST",
              {
                name: text(d, "name"),
                contact: text(d, "contact"),
                notes: text(d, "notes"),
              },
              k,
            ),
        ),
      ),
    ) +
    `</div>`
  );
}
