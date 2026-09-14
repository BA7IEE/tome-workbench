import {
  request,
  esc,
  section,
  table,
  when,
  button,
  reload,
  note,
} from "./core";
import { onPageReady } from "./page-lifecycle";
interface Row {
  id: string;
  createdAt: string;
  actionLabel?: string;
  actorName?: string;
  itemId?: string;
  targetName: string;
  eventLabel?: string;
  statusLabel?: string;
  status?: string;
  attempts?: number;
  help?: string;
  action?: string;
  kind?: string;
  lastError?: string;
  resourceId?: string;
  detail?: unknown;
}
const technical = (value: unknown) =>
  `<details class="technical-details"><summary>技术详情</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
export async function logsPage(jobs = false) {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    page = Number(qs.get("page") || 1),
    status = qs.get("status") ?? "FAILED",
    q = qs.get("q") || "",
    root = "logs-" + crypto.randomUUID(),
    route = jobs ? "jobs" : "audit";
  const result = await request<{
    rows: Row[];
    total: number;
    page: number;
    size: number;
  }>(
    jobs
      ? `/operations/background-jobs?page=${page}&status=${encodeURIComponent(status)}`
      : `/operations/audit-logs?page=${page}&q=${encodeURIComponent(q)}`,
  );
  const go = (p: number, query?: string) => {
    const n = new URLSearchParams(qs);
    n.set("page", String(p));
    if (query !== undefined) n.set(jobs ? "status" : "q", query);
    location.hash = "/" + route + "?" + n;
  };
  onPageReady(root, (el, signal) =>
    el.querySelector("form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        go(
          1,
          String(
            new FormData(e.currentTarget as HTMLFormElement).get("query") || "",
          ),
        );
      },
      { signal },
    ),
  );
  const target = (r: Row) =>
    r.itemId
      ? `<a href="#/items/${r.itemId}">${esc(r.targetName)}</a>`
      : esc(r.targetName);
  const filters = jobs
    ? `<select name="query" aria-label="任务状态">${Object.entries({
        FAILED: "执行失败",
        PENDING: "等待执行",
        WORKING: "正在执行",
        DONE: "已完成",
        "": "全部状态",
      })
        .map(
          ([v, l]) =>
            `<option value="${v}" ${status === v ? "selected" : ""}>${l}</option>`,
        )
        .join("")}</select>`
    : `<input name="query" aria-label="搜索操作记录" placeholder="商品编号、商品名、操作人或操作名称" value="${esc(q)}">`;
  const rows = jobs
    ? result.rows.map((r) => [
        when(r.createdAt),
        esc(r.eventLabel),
        target(r),
        esc(r.statusLabel),
        String(r.attempts),
        esc(r.help) +
          (r.status === "FAILED"
            ? button("重试此任务", async () => {
                await request(`/jobs/${r.id}/retry`, "POST", {});
                await reload();
              })
            : "") +
          technical({
            事件代码: r.kind,
            错误代码: r.lastError,
            任务编号: r.id,
          }),
      ])
    : result.rows.map((r) => [
        when(r.createdAt),
        esc(r.actorName),
        esc(r.actionLabel),
        target(r),
        technical({
          操作代码: r.action,
          记录编号: r.id,
          对象编号: r.resourceId,
          明细: r.detail,
        }),
      ]);
  return (
    `<div id="${root}">` +
    section(
      jobs ? "后台任务" : "操作记录",
      note(
        jobs
          ? "后台任务只处理系统内部状态，不代表外部平台已同步。失败原因和处理建议列在下方。"
          : "查看谁在什么时间做了什么操作；程序代码收在技术详情中，日常使用无需阅读。",
      ) +
        `<form class="filters">${filters}<button class="btn primary">查询</button><span>共${result.total}条</span></form>` +
        table(
          jobs
            ? ["时间", "任务内容", "商品", "执行状态", "已尝试次数", "处理建议"]
            : ["时间", "操作人", "操作内容", "对象", "详情"],
          rows,
        ),
    ) +
    `<div class="pagination"><span>第${page}页</span>${page > 1 ? button("上一页", () => go(page - 1)) : ""}${page * result.size < result.total ? button("下一页", () => go(page + 1)) : ""}</div></div>`
  );
}
