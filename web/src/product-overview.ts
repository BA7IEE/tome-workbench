import { button, can, esc, money, section } from "./core";
import { categories, states, type Item } from "./types";
import {
  catalogBrand,
  catalogCondition,
  sourceFieldNote,
} from "./item-source-facts";
import { productHref, productReturn } from "./product-navigation";
import { productImages, showProductImages } from "./product-images";
import { exportMaterials } from "./materials";
import { showItemEvidence } from "./source-evidence";
import { studioStock } from "./studio-stock";
import { onPageReady } from "./page-lifecycle";
import { catalogContext } from "./catalog-context";
import { deleteProduct } from "./recycle-bin";

export function productOverview(item: Item) {
  const root = "product-overview-" + crypto.randomUUID();
  const images = productImages(item.assets).filter(
      (a) => a.role !== "AI_MARKETING",
    ),
    f = item.facts;
  const back = productReturn(item);
  const self = productHref(item.id, back.href);
  const edit = `#/items/${item.id}/edit?returnTo=${encodeURIComponent(self)}`;
  const details = (rows: [string, unknown][]) =>
    `<dl class="product-overview-facts">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "未填写")}</dd></div>`).join("")}</dl>`;
  const link = (tab: string, label: string) =>
    `<a class="btn" href="${esc(productHref(item.id, self, tab))}">${label}</a>`;
  const browsing =
    !new URLSearchParams(location.hash.split("?")[1] || "").get("returnTo") ||
    /^#\/items(?:\?|$)/.test(back.href);
  const ids = browsing ? catalogContext().browse : [],
    index = ids.indexOf(item.id);
  const adjacent = (delta: number, label: string) =>
    index >= 0 && ids[index + delta]
      ? `<a class="btn subtle" href="${esc(productHref(ids[index + delta], back.href))}">${label}</a>`
      : "";
  const missing = [
    !images.length && "图片",
    item.currentPrice == null && "报价",
    !f.sizeLabel && "尺码",
    !f.descriptionZh && !f.descriptionEn && "介绍",
  ].filter(Boolean);
  onPageReady(root, (el) => {
    studioStock(
      el,
      () => item,
      () => {
        el.querySelector("[data-overview-status]")!.textContent =
          states[item.status] || item.status;
      },
    );
  });
  return `<div id="${root}" class="product-overview"><nav class="product-overview-breadcrumb" aria-label="当前位置"><a href="${esc(back.href)}">← ${esc(back.label)}</a><div>${adjacent(-1, "上一件")}${adjacent(1, "下一件")}</div></nav>
    <header class="product-overview-header"><div><p class="eyebrow">${esc(item.code)} · ${esc(categories[item.category])}${item.dataMode === "TEST" ? " · 测试商品" : ""} · <span data-overview-status>${esc(states[item.status] || item.status)}</span></p><h1>${esc(item.title)}</h1><p>${esc(catalogBrand(item))}</p></div><div class="button-row">${
      can("edit")
        ? button(
            "编辑商品",
            () => {
              location.hash = edit;
            },
            "primary",
          )
        : ""
    }${button("下载商品资料", () => exportMaterials([item]))}${can("delete") ? `<details class="studio-more overview-more"><summary class="btn subtle">更多</summary><div class="studio-more-menu">${button("删除商品", () => deleteProduct(item), "danger")}</div></details>` : ""}</div></header>
    <div class="product-overview-layout"><section class="panel product-overview-gallery" aria-label="商品图片">${images.length ? `<div class="product-overview-cover">${button("", () => showProductImages(images, images[0].id), "overview-cover-button").replace("></button>", ` aria-label="查看商品大图"><img src="/api/assets/${images[0].id}/preview" alt="${esc(item.title)}"></button>`)}</div><div class="product-overview-thumbnails">${images.map((a, n) => button("", () => showProductImages(images, a.id), "overview-thumbnail").replace("></button>", ` aria-label="查看第 ${n + 1} 张图片"><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}" loading="lazy"></button>`)).join("")}</div><p class="note">${images.length} 张图片 · 点击可连续翻图、放大及下载原图</p>` : '<div class="empty"><p>还没有图片</p><p>可以先保存商品，之后再补。</p></div>'}</section>
    <div class="product-overview-info"><section class="panel"><div class="product-overview-prices"><div><span>对外报价</span><strong>${item.currentPrice == null ? "尚未报价" : money(item.currentPrice, item.currency)}</strong></div>${can("finance") ? `<div><span>人民币成本</span><strong>${item.currentCostCny == null ? "尚未确认" : money(item.currentCostCny, "CNY")}</strong></div>` : ""}</div>${details(
      [
        ["品牌", catalogBrand(item)],
        ["品类", categories[item.category]],
        ["成色", catalogCondition(item)],
        ["尺码", f.sizeLabel],
        ["颜色", f.color],
        ["实物持有", item.ownership === "OWN" ? "我方持有" : "供应商持有"],
        ["存放位置", item.location],
      ],
    )}${sourceFieldNote(item, "condition")}</section>
    <section class="panel product-overview-operations"><h2>经营操作</h2><div data-stock-controls></div><p class="note">售出、暂停等操作独立生效。资料未补齐也可以登记实际经营情况。</p></section>
    ${missing.length ? `<p class="product-overview-gaps">还可补充：${missing.join("、")}。${can("edit") ? `<a href="${esc(edit)}">去补充</a>` : ""}</p>` : ""}</div></div>
    ${section("商品介绍", `<div class="product-overview-descriptions"><div><h3>中文介绍</h3><div class="copy">${esc(f.descriptionZh || "未填写")}</div></div><div><h3>英文介绍</h3><div class="copy">${esc(f.descriptionEn || "未填写")}</div></div></div>`)}
    ${section(
      "尺寸、材质与品相",
      details([
        ["实测尺寸", f.measurements],
        ["尺寸依据", f.measurementSource],
        ["主要材质", f.mainMaterial],
        ["材质成分 / 细节", f.material],
        ["瑕疵与使用痕迹", f.condition],
      ]),
    )}
    <details class="panel product-overview-records"><summary>来源、复核与详细记录</summary><div class="button-row">${button("查看全部来源资料", () => showItemEvidence(item.id))}${link("facts", "完整资料与复核")}${link("assets", "素材管理")}${link("supply", "货源与交接")}${can("finance") ? link("costs", "成本明细") : ""}${link("history", "版本与记录")}${can("publish") ? link("use", "准备发布") : ""}</div><p class="note">来源原始记录保留在这里，人工维护的商品资料以当前档案为准。</p></details></div>`;
}
