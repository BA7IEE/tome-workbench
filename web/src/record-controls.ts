import { field, select, can, esc } from "./core";
import { onPageReady } from "./page-lifecycle";

export function recordParams(qs: URLSearchParams) {
  const p = new URLSearchParams({ page: qs.get("page") || "1", size: "50" });
  for (const k of [
    "id",
    "itemId",
    "q",
    "channel",
    "customer",
    "dateFrom",
    "dateTo",
    "state",
    "pending",
    "dataMode",
    "listingState",
  ]) {
    const v = qs.get(k);
    if (v) p.set(k, v);
  }
  return p;
}
function contextHref(
  route: string,
  qs: URLSearchParams,
  keepIdentity: boolean,
) {
  const p = new URLSearchParams();
  if (qs.get("dataMode") === "TEST") p.set("dataMode", "TEST");
  if (qs.get("from") === "tasks") p.set("from", "tasks");
  const back = safeReturn(qs.get("returnTo"));
  if (back) p.set("returnTo", back);
  if (keepIdentity)
    for (const key of ["id", "itemId"])
      if (qs.get(key)) p.set(key, qs.get(key)!);
  return `#/${route}${p.size ? "?" + p.toString() : ""}`;
}
export function recordFilters(
  route: string,
  qs: URLSearchParams,
  kind: "sales" | "inquiries" | "listings",
) {
  const id = `${route}-filter`;
  onPageReady(id, (el, signal) =>
    el.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const p = new URLSearchParams(qs);
        p.delete("page");
        for (const [k, v] of new FormData(el as HTMLFormElement)) {
          if (v) p.set(k, String(v));
          else p.delete(k);
        }
        location.hash = `/${route}?${p}`;
      },
      { signal },
    ),
  );
  return `<form id="${id}" class="admin-filter-form">${field("q", kind === "sales" ? "搜索成交商品" : "搜索商品", qs.get("q") || "", "text", false, 'placeholder="商品编号或名称"')}${field("channel", "渠道", qs.get("channel") || "")}${kind !== "listings" ? field("customer", "客户", qs.get("customer") || "") : ""}${kind === "inquiries" ? select("state", "跟进状态", { "": "全部状态", OPEN: "待跟进", FOLLOWUP: "跟进中", WON: "已转化", LOST: "未成交" }, qs.get("state") || "") : ""}${kind === "listings" ? select("listingState", "发布状态", { "": "全部状态", LIVE: "保持在线", OFFLINE: "要求下架" }, qs.get("listingState") || "") : ""}${kind === "sales" && can("finance") ? select("pending", "收支核对", { "": "全部记录", "1": "待补收支" }, qs.get("pending") || "") : ""}${kind !== "inquiries" && can("users") ? select("dataMode", kind === "sales" ? "成交记录类型" : "发布记录类型", { BUSINESS: "正式记录", TEST: "模拟记录（含已清理）" }, qs.get("dataMode") || "BUSINESS") : ""}${field("dateFrom", "开始日期", qs.get("dateFrom") || "", "date")}${field("dateTo", "结束日期", qs.get("dateTo") || "", "date")}<button class="btn primary">查询</button><a class="btn" href="${esc(contextHref(route, qs, true))}">重置</a></form>`;
}
export function recordPaging(
  route: string,
  qs: URLSearchParams,
  r: { total: number; page: number; size: number },
) {
  const link = (page: number, label: string) => {
    const p = new URLSearchParams(qs);
    p.set("page", String(page));
    return `<a class="btn" href="#/${route}?${esc(p.toString())}">${label}</a>`;
  };
  return `<div class="pagination"><span>共 ${r.total} 条 · 第 ${r.page} / ${Math.max(1, Math.ceil(r.total / r.size))} 页</span>${r.page > 1 ? link(r.page - 1, "上一页") : ""}${r.page * r.size < r.total ? link(r.page + 1, "下一页") : ""}</div>`;
}
export function safeReturn(value: string | null) {
  return value &&
    /^#\/(items|candidates|procurement|tasks|collections|sales|inquiries|listings)(?:[/?]|$)/.test(value)
    ? value
    : "";
}
export function recordContext(qs: URLSearchParams, route: string) {
  const back = safeReturn(qs.get("returnTo")),
    tasks = qs.get("from") === "tasks",
    single = qs.has("id"),
    item = qs.has("itemId");
  return single || item || back || tasks
    ? `<div class="notice inquiry-context">${single ? "当前仅显示这条记录。" : item ? "当前仅显示这件商品的记录。" : ""}<div class="button-row"><a class="btn" href="${esc(contextHref(route, qs, false))}">查看全部${route === "inquiries" ? "询盘" : "记录"}</a>${tasks ? `<a class="btn" href="#/tasks?scope=${route === "sales" ? "SALE_FINANCE" : "INQUIRY"}">返回${route === "sales" ? "成交补账" : "客户跟进"}待办</a>` : ""}${back ? `<a class="btn" href="${esc(back)}">${back.startsWith("#/items") ? "返回商品工作区" : "返回来源页面"}</a>` : ""}</div></div>`
    : "";
}
