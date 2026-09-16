import { cleanupTestData } from "./test-data";
import {
  request,
  can,
  esc,
  when,
  button,
  form,
  note,
  select,
  section,
  table,
  reload,
} from "./core";
import { catalogContext, clearEditQueue } from "./catalog-context";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import { onPageReady } from "./page-lifecycle";
import type { Item } from "./types";
type Target = Pick<Item, "id" | "code" | "title" | "version"> & {
  dataMode?: string;
};
const reasons = {
  测试商品: "测试商品",
  误录或重复建档: "误录或重复建档",
  不再经营此商品: "不再经营此商品",
};
export function deleteProduct(item: Target) {
  form(
    "删除商品 · " + item.code,
    `<p><strong>${esc(item.title)}</strong></p>` +
      note(
        "删除后移入回收站，可恢复；不会回收TM号或删除原图。已成交、有成本或预留，以及尚未下架的商品会被拦截。",
      ) +
      select("reason", "删除原因", reasons, "测试商品") +
      (can("users")
        ? button("有模拟成交？清理测试数据", () => cleanupTestData(item))
        : ""),
    async (d, key) => {
      const result = await request(
        `/items/${item.id}/trash`,
        "POST",
        {
          version: item.version,
          reason: String(d.get("reason")),
          confirmed: true,
        },
        key,
      );
      catalogContext().selected.delete(item.id);
      clearEditQueue();
      return result;
    },
    "确认删除",
    async () => {
      await reload();
    },
  );
}
export function deleteProducts(items: Target[]) {
  if (!items.length || items.length > 100) throw new Error("请选择1—100件商品");
  form(
    "批量删除 · " + items.length + " 件",
    note(
      "仅处理下列勾选商品；有成交、成本、预留或未下架渠道的项目不会删除。每件的结果分别显示。",
    ) +
      `<div class="batch-results">${items.map((i) => `<p>${esc(i.code)} · ${esc(i.title)}</p>`).join("")}</div>` +
      select("reason", "删除原因", reasons, "测试商品"),
    async (d) => {
      const reason = String(d.get("reason"));
      setTimeout(
        () =>
          batchActions(
            "批量删除结果",
            items.map((i) => ({
              label: i.code + " " + i.title,
              run: async (key) => {
                const result = await request(
                  `/items/${i.id}/trash`,
                  "POST",
                  { version: i.version, reason, confirmed: true },
                  key,
                );
                catalogContext().selected.delete(i.id);
                clearEditQueue();
                return result;
              },
            })),
          ),
        0,
      );
      return { nextStep: true };
    },
    "核对所选商品",
  );
}
export function restoreProduct(item: Target) {
  form(
    "恢复商品 · " + item.code,
    `<p>${esc(item.title)}</p>` +
      note(
        item.dataMode === "TEST"
          ? "恢复后仍是测试商品，保留原编号和模拟成交，保持暂停，不会转成正式业务。"
          : "恢复保留原编号和资料。商品先处于暂停、待复核状态，不会自动上架；核对库存后再恢复可售。",
      ),
    (d, key) => {
      void d;
      return request(
        `/items/${item.id}/restore`,
        "POST",
        { version: item.version, reason: "从回收站恢复", confirmed: true },
        key,
      );
    },
    "确认恢复",
  );
}
export function deletedNotice(item: Item) {
  return section(
    "该商品已移入回收站",
    `<p><strong>${esc(item.code)} · ${esc(item.title)}</strong></p><p>删除时间：${when(item.deletedAt)}；原因：${esc(item.deletionReason || "")}</p>` +
      note(
        "资料、原图和编号仍保留。需要继续使用时，请先恢复商品；旧编辑页面不能直接写入。",
      ) +
      '<div class="button-row"><a class="btn" href="#/items">返回商品列表</a>' +
      (can("delete")
        ? '<a class="btn" href="#/trash">查看回收站</a>' +
          button("恢复商品", () => restoreProduct(item), "primary")
        : "") +
      "</div>",
  );
}
export async function recycleBinPage() {
  if (!can("delete"))
    return section(
      "商品回收站",
      note("此账号没有删除或恢复权限，请联系管理员。"),
    );
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "",
    root = "trash-" + crypto.randomUUID();
  const result = await request<{
    total: number;
    page: number;
    rows: (Target & { deletedAt: string; deletionReason: string })[];
  }>(
    `/recycle-bin/items?q=${encodeURIComponent(q)}&page=${encodeURIComponent(qs.get("page") || "1")}`,
  );
  const go = (page: number) => {
    qs.set("page", String(page));
    location.hash = "/trash?" + qs;
  };
  onPageReady(root, (el, signal) => {
    el.querySelector("form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget as HTMLFormElement);
        const hash =
          "/trash?" + new URLSearchParams({ q: String(d.get("q") || "") });
        if (location.hash === "#" + hash) void reload();
        else location.hash = hash;
      },
      { signal },
    );
  });
  return (
    `<div id="${root}"><div class="page-title"><div><h1>商品回收站</h1><p>误删可以恢复；编号与原始记录保留，不提供一键清空经营历史。</p></div><a class="btn" href="#/items">返回商品列表</a></div>` +
    section(
      "已删除商品",
      `<form class="filters"><input name="q" aria-label="搜索回收站" placeholder="编号、名称或品牌" value="${esc(q)}"><button class="btn">搜索</button></form>` +
        table(
          ["商品", "删除时间", "原因", "操作"],
          result.rows.map((i) => [
            `${esc(i.title)}<small>${esc(i.code)}${i.dataMode === "TEST" ? " · 测试数据" : ""}</small>`,
            when(i.deletedAt),
            esc(i.deletionReason),
            button("恢复商品", () => restoreProduct(i)) +
              (i.dataMode === "TEST" && can("finance")
                ? `<a class="btn" href="#/sales?dataMode=TEST&q=${encodeURIComponent(i.code)}">查看保留的模拟成交</a>`
                : ""),
          ]),
        ),
    ) +
    `<div class="pagination"><span>共 ${result.total} 件 · 第 ${result.page} 页</span>${result.page > 1 ? button("上一页", () => go(result.page - 1)) : ""}${result.page * 30 < result.total ? button("下一页", () => go(result.page + 1)) : ""}</div></div>`
  );
}
