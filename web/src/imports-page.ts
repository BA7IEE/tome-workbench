import { can, esc, request, when, reload } from "./core";
import { onPageReady } from "./page-lifecycle";
export async function importsPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "",
    page = qs.get("page") || "1";
  const data = await request<{
    total: number;
    page: number;
    rows: {
      id: string;
      externalBatchKey: string;
      status: string;
      createdAt: string;
      agentName: string;
      procurementSource: { name: string };
      _count: { members: number };
      counts: Record<string, number>;
    }[];
  }>(`/ingest/batch-records?${new URLSearchParams({ q, page })}`);
  const root = "imports-" + crypto.randomUUID();
  onPageReady(root, (el, signal) =>
    el.querySelector("form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const value = String(
          new FormData(e.currentTarget as HTMLFormElement).get("q") || "",
        );
        const target = "#/imports?" + new URLSearchParams({ q: value });
        if (location.hash === target) void reload();
        else location.hash = target;
      },
      { signal },
    ),
  );
  return `<div id="${root}" class="imports-page"><div class="page-title"><div><h1>导入记录</h1><p>按批次核对资料，已确认的商品回到商品库维护。</p></div><div class="button-row"><a class="btn primary" href="#/candidates">处理全部待确认</a>${can("supply") ? '<a class="btn" href="#/candidates?access=1">外部工具接入</a>' : ""}</div></div>
  <form class="admin-filter-form"><label class="search-field"><span>查找导入批次</span><input name="q" value="${esc(q)}" placeholder="批次名称或来源"></label><button class="btn">查找</button></form>
  <div class="import-records">${data.rows.map((b) => `<article class="panel import-record"><div><small>${esc(b.procurementSource.name)} · ${when(b.createdAt)}</small><h2>${esc(b.externalBatchKey)}</h2><p>${b._count.members} 件 · 待确认 ${b.counts.PENDING || 0} · 已归入 ${b.counts.CONFIRMED || 0} · 已排除 ${b.counts.EXCLUDED || 0}</p><small>${b.status === "SEALED" ? "资料已接收完成" : "仍在接收资料"} · ${esc(b.agentName)}</small></div><div class="button-row"><a class="btn primary" href="#/candidates?batchId=${b.id}&decision=${b.counts.PENDING ? "PENDING" : b.counts.CONFIRMED ? "CONFIRMED" : ""}&returnTo=${encodeURIComponent(location.hash)}">${b.counts.PENDING ? "处理本批" : b.counts.CONFIRMED ? "查看本批商品" : "查看本批记录"}</a><a class="btn" href="#/candidates?batchId=${b.id}&decision=&returnTo=${encodeURIComponent(location.hash)}">全部记录</a></div></article>`).join("") || '<div class="empty panel"><h2>还没有导入记录</h2><p>少量商品可以快速录货；批量资料由外部工具整理后送入待确认。</p><a class="btn" href="#/items">去录入商品</a></div>'}</div>
  <div class="pagination"><span>共 ${data.total} 批</span>${data.page > 1 ? `<a class="btn" href="#/imports?${new URLSearchParams({ q, page: String(data.page - 1) })}">上一页</a>` : ""}${data.page * 30 < data.total ? `<a class="btn" href="#/imports?${new URLSearchParams({ q, page: String(data.page + 1) })}">下一页</a>` : ""}</div></div>`;
}
