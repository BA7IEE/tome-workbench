import { exportMaterials, materialHistory } from "./materials";
import { beginCollection } from "./collection-builder";
import { bulkPrices } from "./bulk-prices";
import { quickEdit } from "./quick-edit";
import { bindCatalogMenus } from "./catalog-menu";
import { catalogBrand, catalogCondition } from "./item-source-facts";
import { quickIntake } from "./quick-intake";
import { bulkDictionaries } from "./bulk-dictionaries";
import {
  dictionaryFilterField,
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import { deleteProduct, deleteProducts } from "./recycle-bin";
import {
  request,
  can,
  esc,
  money,
  button,
  area,
  field,
  select,
  form,
  note,
  reload,
  toast,
  when,
} from "./core";
import { onPageReady } from "./page-lifecycle";
import {
  catalogContext,
  rememberList,
  selectItem,
  beginEditQueue,
  saveListScroll,
} from "./catalog-context";
import { batchActions } from "./batch-actions";
import type { Item, Channel } from "./types";
import { states, categories } from "./types";
function downloadCsv(rows: Item[]) {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const body = [
    [
      "商品编号",
      "名称",
      "品牌",
      "品类",
      "状态",
      "实物持有",
      "位置",
      "币种",
      "对外报价",
      "资料状态",
    ],
    ...rows.map((i) => [
      i.code,
      i.title,
      i.brand,
      categories[i.category],
      states[i.status],
      i.ownership === "OWN" ? "我方持有" : "供应商持有",
      i.location,
      i.currency,
      i.currentPrice === null ? "" : (i.currentPrice / 100).toFixed(2),
      i.approvedValid ? "已确认" : "待确认",
    ]),
  ]
    .map((r) => r.map(safe).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
      new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "兔泥巴商品清单.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function catalogScreen() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "",
    status = qs.get("status") || "",
    requestedPage = Math.max(1, Number(qs.get("page") || 1)),
    view = qs.get("view") || "table";
  const filters = new URLSearchParams({
    q,
    status,
    page: String(requestedPage),
  });
  for (const k of [
    "brandId",
    "conditionId",
    "colorId",
    "materialId",
    "sizeLabel",
    "location",
    "source",
    "missing",
    "dataMode",
    "size",
    "category",
    "ownership",
    "review",
    "listing",
    "sort",
  ])
    if (qs.has(k)) filters.set(k, qs.get(k)!);
  const scope = new URLSearchParams(filters);
  for (const k of ["page", "size", "sort"]) scope.delete(k);
  const previous = catalogContext();
  const restoreScroll =
    previous.listHash === location.hash ? previous.listScroll : 0;
  rememberList(location.hash, scope.toString(), restoreScroll);
  const data = await request<{
      rows: Item[];
      total: number;
      page: number;
      size: number;
    }>(`/items?${filters}`),
    root = "catalog-" + crypto.randomUUID(),
    selected = catalogContext().selected,
    page = data.page,
    size = data.size;
  for (const row of data.rows) if (selected.has(row.id)) selectItem(row, true);
  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    rememberList("#/items?" + next, scope.toString(), 0);
    if (location.hash === "#/items?" + next) void reload();
    else location.hash = "/items?" + next;
  };
  const photo = (i: Item) =>
    i.assets[0]
      ? `<img src="/api/assets/${i.assets[0].id}/preview" alt="${esc(i.title)}" loading="lazy">`
      : '<div class="product-no-image"><span>还没有图片</span></div>';
  const quote = (i: Item) =>
    i.currentPrice == null ? "尚未报价" : money(i.currentPrice, i.currency);
  const resetFilters = () => {
    selected.clear();
    go(
      Object.fromEntries(
        [
          "q",
          "status",
          "category",
          "ownership",
          "review",
          "listing",
          "brandId",
          "conditionId",
          "colorId",
          "materialId",
          "sizeLabel",
          "location",
          "source",
          "missing",
          "page",
        ].map((key) => [key, ""]),
      ),
    );
  };
  const mini = (i: Item) =>
    `${i.dataMode === "TEST" ? '<span class="status-pill test">测试</span>' : ""}<span class="status-pill ${i.status === "AVAILABLE" ? "good" : "muted"}">${esc(states[i.status] || i.status)}</span>${i.approvedValid ? "" : '<span class="status-pill attention">待核资料</span>'}`;
  const rowMenu = (i: Item) =>
    `<details class="catalog-row-menu"><summary class="btn subtle" aria-label="${esc(i.code)} 更多操作">•••</summary><div>` +
    (can("edit") ? button("快速修改", () => quickEdit(i, reload)) : "") +
    (can("publish")
      ? `<a href="#/items/${i.id}/edit?publish=1">准备发布</a>`
      : "") +
    (can("delete")
      ? button("删除商品", () => deleteProduct(i), "danger")
      : "") +
    `</div></details>`;
  const cards = data.rows
    .map(
      (i) =>
        `<article class="product-card"><div class="product-visual"><label class="product-check"><input type="checkbox" data-pick="${i.id}" aria-label="选择 ${esc(i.code)}"></label><a href="#/items/${i.id}/${can("edit") ? "edit" : ""}">${photo(i)}</a><span class="product-number">${esc(i.code)}</span></div><div class="product-card-info"><div class="product-card-head"><small>${esc(catalogBrand(i))} · ${esc(categories[i.category])}</small>${rowMenu(i)}</div><a class="product-name" href="#/items/${i.id}/${can("edit") ? "edit" : ""}">${esc(i.title)}</a><div class="tag-row">${mini(i)}</div><p class="product-reference-summary">${esc(catalogCondition(i))}${i.facts.sizeLabel ? ` · 尺码 ${esc(i.facts.sizeLabel)}` : ""}</p><div class="product-bottom"><div><strong>${quote(i)}</strong>${i.currentCostCny !== undefined ? `<small>成本 ${money(i.currentCostCny, "CNY")}</small>` : ""}</div><span>${i.ownership === "OWN" ? "我方持有" : "供应商持有"}</span></div></div></article>`,
    )
    .join("");
  const rows = `<div class="table-wrap"><table><thead><tr><th>选择</th><th>商品</th><th>状态</th><th>成色 / 尺码</th><th>报价</th><th>实物位置</th><th>图片 / 发布记录</th><th></th></tr></thead><tbody>${data.rows.map((i) => `<tr><td><input type="checkbox" data-pick="${i.id}" aria-label="选择 ${esc(i.code)}"></td><td><div class="table-product"><a href="#/items/${i.id}/${can("edit") ? "edit" : ""}" class="table-picture">${photo(i)}</a><div><a href="#/items/${i.id}/${can("edit") ? "edit" : ""}">${esc(i.title)}</a><small>${esc(i.code)} · ${esc(catalogBrand(i))}</small></div></div></td><td><div class="tag-row">${mini(i)}</div></td><td>${esc(catalogCondition(i))}<small>${esc(i.facts.sizeLabel || "")}</small></td><td>${quote(i)}${i.currentCostCny !== undefined ? `<small>成本 ${money(i.currentCostCny, "CNY")}</small>` : ""}</td><td>${i.ownership === "OWN" ? "我方持有" : "供应商持有"}<small>${esc(i.location || "位置待补")}</small></td><td>${i._count?.assets ?? i.assets.length} 张图片<small>${i._count?.listings || 0} 条发布记录</small><small>${i.updatedAt ? when(i.updatedAt) : ""}</small></td><td>${rowMenu(i)}</td></tr>`).join("")}</tbody></table></div>`;
  onPageReady(root, (el, signal) => {
    bindCatalogMenus(el, signal);
    bindDictionaryFields(
      el.querySelector<HTMLFormElement>("#catalog-search")!,
      signal,
    );
    const toolbar = el.querySelector<HTMLElement>("#bulk-toolbar")!;
    const chosen = () => Array.from(selected.values());
    const paint = () => {
      const boxes = Array.from(
        el.querySelectorAll<HTMLInputElement>("[data-pick]"),
      );
      for (const box of boxes) {
        box.checked = selected.has(box.dataset.pick!);
        box
          .closest(".product-card,tr")
          ?.classList.toggle("is-selected", box.checked);
      }
      const all = el.querySelector<HTMLInputElement>("#select-page")!,
        count = boxes.filter((b) => b.checked).length;
      all.disabled = boxes.length === 0;
      all.checked = boxes.length > 0 && count === boxes.length;
      all.indeterminate = count > 0 && count < boxes.length;
      toolbar.hidden = selected.size === 0;
      toolbar.innerHTML =
        `<span>已选 ${selected.size} 件（跨页保留，最多100件）</span>` +
        (selected.size
          ? button("取消选择", () => {
              selected.clear();
              paint();
            }) +
            button("下载商品资料", () => exportMaterials(chosen()), "primary") +
            button("导出清单", () => downloadCsv(chosen())) +
            (can("publish")
              ? button("创建客户选品", () => beginCollection(chosen()))
              : "") +
            (can("edit")
              ? button("批量定价", () => bulkPrices(chosen()))
              : "") +
            (can("edit")
              ? button("批量修改属性", () => bulkDictionaries(chosen()))
              : "") +
            (can("delete")
              ? button("批量删除", () => deleteProducts(chosen()), "danger")
              : "") +
            (can("edit")
              ? button("逐件编辑", () => {
                  const ids = chosen().map((i) => i.id);
                  beginEditQueue(ids);
                  saveListScroll();
                  location.hash = `/items/${ids[0]}/edit`;
                })
              : "") +
            (can("edit")
              ? button("批量修改位置", () => {
                  const list = chosen();
                  form(
                    "批量登记位置与保管人",
                    note(
                      `将为所选${list.length}件分别记录交接，有冲突的商品不会被覆盖。`,
                    ) +
                      field("to", "新位置或保管人", "", "text", true) +
                      area("evidence", "本次交接依据", "", 2),
                    async (d) => {
                      const to = String(d.get("to") || ""),
                        evidence = String(d.get("evidence") || "").trim();
                      if (!evidence) throw new Error("请填写交接依据");
                      setTimeout(
                        () =>
                          batchActions(
                            "商品位置更新",
                            list.map((i) => ({
                              label: i.code + " " + i.title,
                              run: (key) =>
                                request(
                                  `/items/${i.id}/move`,
                                  "POST",
                                  { version: i.version, to, evidence },
                                  key,
                                ),
                            })),
                          ),
                        0,
                      );
                      return { nextStep: true };
                    },
                  );
                })
              : "") +
            (can("sell")
              ? button("批量暂停推广", () => {
                  const list = chosen();
                  form(
                    "暂停所选商品推广",
                    note(
                      "不会把商品标记成已售，不会产生收入；已经发布的渠道仍需完成下架回执。",
                    ) + area("reason", "暂停原因", "", 2),
                    async (d) => {
                      const reason = String(d.get("reason") || "").trim();
                      if (!reason) throw new Error("请填写原因");
                      setTimeout(
                        () =>
                          batchActions(
                            "暂停推广结果",
                            list.map((i) => ({
                              label: i.code + " " + i.title,
                              run: (key) =>
                                request(
                                  `/items/${i.id}/state`,
                                  "POST",
                                  { state: "PAUSED", reason },
                                  key,
                                ),
                            })),
                          ),
                        0,
                      );
                      return { nextStep: true };
                    },
                  );
                })
              : "") +
            (can("edit")
              ? button("安排补资料", async () => {
                  const channels = await request<Channel[]>("/channels"),
                    choices = Object.fromEntries(
                      channels
                        .filter((c) => c.active)
                        .map((c) => [c.id, c.name]),
                    );
                  if (!Object.keys(choices).length)
                    throw new Error("先在设置中添加常用渠道");
                  const list = chosen();
                  form(
                    "按用途安排补资料",
                    select("channelId", "目标渠道", choices),
                    async (d) => {
                      const channelId = String(d.get("channelId"));
                      setTimeout(
                        () =>
                          batchActions(
                            "检查与安排工作",
                            list.map((i) => ({
                              label: i.code + " " + i.title,
                              run: (key) =>
                                request(
                                  `/items/${i.id}/prepare`,
                                  "POST",
                                  { channelId, purpose: "TRADE" },
                                  key,
                                ),
                            })),
                          ),
                        0,
                      );
                      return { nextStep: true };
                    },
                  );
                })
              : "")
          : "<small>勾选商品后可以导出、记录位置或安排补资料</small>");
    };
    el.addEventListener(
      "change",
      (e) => {
        const t = e.target as HTMLInputElement;
        try {
          if (t.id === "select-page") {
            for (const row of data.rows) selectItem(row, t.checked);
          } else if (t.dataset.pick) {
            const row = data.rows.find((i) => i.id === t.dataset.pick);
            if (row) selectItem(row, t.checked);
          }
        } catch (error) {
          toast((error as Error).message, true);
        }
        paint();
      },
      { signal },
    );
    el.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element).closest('a[href^="#/items/"]'))
          saveListScroll();
      },
      { signal },
    );
    el.querySelector("#catalog-search")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const filterForm = e.currentTarget as HTMLFormElement;
        const d = new FormData(filterForm);
        let picked;
        try {
          picked = readDictionarySelections(filterForm).dictionary;
        } catch (error) {
          toast((error as Error).message, true);
          return;
        }
        for (const [key, value] of Object.entries({
          brandId: picked.brand,
          conditionId: picked.condition,
          colorId: picked.color,
          materialId: picked.material,
        })) {
          if (value) qs.set(key, value);
          else qs.delete(key);
        }
        go(
          Object.fromEntries(
            [
              "dataMode",
              "q",
              "status",
              "category",
              "ownership",
              "review",
              "listing",
              "sort",
              "size",
              "sizeLabel",
              "location",
              "source",
              "missing",
            ]
              .map((k) => [k, String(d.get(k) || "")])
              .concat([["page", ""]]),
          ),
        );
      },
      { signal },
    );
    el.querySelectorAll<HTMLButtonElement>(".view-switch button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.classList.contains("active"))),
    );
    paint();
    if (restoreScroll) window.scrollTo(0, restoreScroll);
  });
  const options = (choices: Record<string, string>, value: string) =>
    Object.entries(choices)
      .map(
        ([k, label]) =>
          `<option value="${k}" ${value === k ? "selected" : ""}>${esc(label)}</option>`,
      )
      .join("");
  const statusChoices = Object.fromEntries(
    [
      "AVAILABLE",
      "PAUSED",
      "RESERVED",
      "SOLD",
      "SUPPLIER_SOLD",
      "GIFTED",
      "SELF_USE",
      "QUARANTINED",
    ].map((k) => [k, states[k]]),
  );
  const scopeTabs = can("users")
    ? `<nav class="catalog-scope-tabs" aria-label="商品数据范围"><a class="${(qs.get("dataMode") || "BUSINESS") === "BUSINESS" ? "active" : ""}" href="#/items?dataMode=BUSINESS">正式商品</a><a class="${qs.get("dataMode") === "TEST" ? "active" : ""}" href="#/items?dataMode=TEST">测试商品</a></nav>`
    : "";
  const pageMore =
    can("edit") || can("supply") || can("delete")
      ? `<details class="page-actions-menu"><summary class="btn">更多</summary><div>${can("edit") ? '<a href="#/items/new">完整建档</a>' : ""}${can("supply") ? '<a href="#/sources">从货源导入</a>' : ""}${can("delete") ? '<a href="#/trash">回收站</a>' : ""}</div></details>`
      : "";
  return `<div id="${root}" class="catalog-page"><div class="page-title"><div><h1>商品</h1>${scopeTabs}</div><div class="button-row">${can("edit") ? button("＋ 快速录货", () => quickIntake(reload), "primary") : ""}${button("资料包与变化", materialHistory)}${pageMore}</div></div>
  <form id="catalog-search" class="catalog-filters admin-filter-form"><input type="hidden" name="dataMode" value="${esc(qs.get("dataMode") || "BUSINESS")}"><label class="search-field"><span>搜索商品</span><input name="q" aria-label="搜索商品" placeholder="编号、旧编号、品牌或名称" value="${esc(q)}"></label><label><span>库存状态</span><select name="status" aria-label="商品状态">${options({ "": "全部库存状态", ...statusChoices }, status)}</select></label><label><span>商品品类</span><select name="category" aria-label="筛选品类">${options({ "": "全部品类", ...categories }, qs.get("category") || "")}</select></label>
  <details class="extra-filters" ${["ownership", "review", "listing", "brandId", "conditionId", "colorId", "materialId", "sizeLabel", "location", "source", "missing"].some((k) => qs.get(k)) ? "open" : ""}><summary>更多筛选</summary><div class="library-find-grid">${field("sizeLabel", "尺码", qs.get("sizeLabel") || "")}${field("location", "实物位置", qs.get("location") || "")}${field("source", "来源名称", qs.get("source") || "")}${select("missing", "待补资料", { "": "全部资料", images: "缺图片", price: "缺售价", size: "缺尺码", description: "缺中文介绍" }, qs.get("missing") || "")}</div><div class="dictionary-filter-grid">${dictionaryFilterField("BRAND", qs.get("brandId") || undefined)}${dictionaryFilterField("CONDITION", qs.get("conditionId") || undefined)}${dictionaryFilterField("COLOR", qs.get("colorId") || undefined)}${dictionaryFilterField("MATERIAL", qs.get("materialId") || undefined)}</div><div class="button-row"><label><span>实物持有</span><select name="ownership">${options({ "": "全部实物持有", OWN: "我方持有", SUPPLIER: "供应商持有" }, qs.get("ownership") || "")}</select></label><label><span>资料状态</span><select name="review">${options({ "": "全部资料状态", pending: "待确认", approved: "已有确认版本" }, qs.get("review") || "")}</select></label><label><span>发布记录</span><select name="listing">${options({ "": "全部发布记录", none: "暂无发布记录", recorded: "有发布记录" }, qs.get("listing") || "")}</select></label></div></details>
  <div class="filter-actions"><button class="btn primary">搜索</button>${button(
    "重置",
    resetFilters,
  )}<label><span>排序</span><select name="sort">${options({ newest: "最新录入", oldest: "最早录入", updated: "最近更新" }, qs.get("sort") || "newest")}</select></label><label><span>每页</span><select name="size">${options({ "30": "30件", "60": "60件", "100": "100件" }, String(size))}</select></label><span class="view-switch">${button("列表", () => go({ view: "table" }), view === "table" ? "active" : "")}${button("图片", () => go({ view: "grid" }), view === "grid" ? "active" : "")}</span></div></form>
  <div class="catalog-count"><label><input type="checkbox" id="select-page">选择本页</label><span>共 ${data.total} 件 · 第 ${page} / ${Math.max(1, Math.ceil(data.total / size))} 页</span></div><div id="bulk-toolbar" class="bulk-toolbar" hidden></div>
  ${data.rows.length ? (view === "table" ? rows : `<div class="product-grid">${cards}</div>`) : `<div class="empty panel"><h2>没有找到商品</h2><p>可以清除筛选条件，或从快速录货开始。</p>${button("清除筛选", resetFilters)}</div>`}
  <div class="pagination"><span>每页${size}件</span>${page > 1 ? button("上一页", () => go({ page: String(page - 1) })) : ""}${page * size < data.total ? button("下一页", () => go({ page: String(page + 1) })) : ""}</div></div>`;
}
