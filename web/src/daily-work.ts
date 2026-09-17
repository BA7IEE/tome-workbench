import { quickIntake } from "./quick-intake";
import { request, can, esc, button, section, note } from "./core";
import type { Channel } from "./types";
import { setupChannel } from "./channel-setup";

interface WorkQueueRow {
  id: string;
  kind:
    | "CANDIDATE"
    | "TASK"
    | "OBSERVATION"
    | "DISTRIBUTION"
    | "INQUIRY"
    | "SALE_FINANCE"
    | "ITEM_REVIEW";
  priority: number;
  title: string;
  detail: string;
  href: string;
  action: string;
}
interface WorkQueue {
  summary: { total: number };
  rows: WorkQueueRow[];
}
export async function dailyWork() {
  const [counts, queue, channels, nextQueue, reviews] = await Promise.all([
    request<Record<string, number>>("/dashboard"),
    request<WorkQueue>("/work-queue?scope=IMPORTANT&size=6"),
    request<Channel[]>("/channels"),
    request<WorkQueue>("/work-queue?scope=NEXT&size=6"),
    request<WorkQueue>("/work-queue?scope=ITEM_REVIEW&size=6"),
  ]);
  const urgent = queue.rows.filter((row) => row.priority >= 80).slice(0, 6),
    next = nextQueue.rows;
  const cards = [
    {
      label: "商品档案",
      value: counts.items,
      to: "#/items",
      sub: "全部正式接手商品",
    },
    {
      label: "可售库存",
      value: counts.available,
      to: "#/items?status=AVAILABLE",
      sub: "发布前仍须核对资料",
    },
    {
      label: "经营待办",
      value: counts.actionable ?? counts.openTasks,
      to: "#/tasks",
      sub: "候选、询盘、停售、补账和冲突",
    },
    {
      label: "待确认来源候选",
      value: counts.pendingCandidates ?? 0,
      to: "#/candidates",
      sub: "Agent采集后等待人工生成TM",
    },
    {
      label: "待确认商品资料",
      value: counts.pendingItemReviews ?? reviews.summary.total,
      to: "#/tasks?scope=ITEM_REVIEW",
      sub: "全部未批准TM，按最新维护时间排序",
    },
    ...(can("publish")
      ? [
          {
            label: "分发异常",
            value: counts.pendingDistribution ?? 0,
            to: "#/distribution?scope=attention",
            sub: "按永久 TM 核对异常分发记录",
          },
        ]
      : []),
  ];
  const onboarding =
    !counts.items || !channels.length
      ? section(
          "把现有业务接进来",
          `<div class="onboarding-steps"><article><span class="step-number">1</span><h3>把货记录下来</h3><p>仅录入已实际在手的我方现货；供应商持有、寄售或远端货源先进入货源与供应商。</p>${can("edit") ? button("快速录入我方现货", () => quickIntake(), "primary") : ""}${can("supply") ? '<a class="btn" href="#/sources">货源与供应商</a>' : ""}</article><article><span class="step-number">2</span><h3>加入实际经营的渠道</h3><p>交易渠道在商品分发里维护；内容渠道不进入交易分发。</p>${can("users") ? button("添加常用渠道", setupChannel) : '<a href="#/settings">查看更多设置</a>'}</article><article><span class="step-number">3</span><h3>确认资料，再取用</h3><p>选图、保存渠道草稿，确认后复制标题、正文和图片。</p><a class="btn" href="#/items">进入商品库</a></article></div>`,
        )
      : "";
  const queueRows = (rows: WorkQueueRow[]) =>
    rows.length
      ? rows
          .map(
            (row) =>
              `<a class="action-row" href="${esc(row.href)}"><div><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></div><span>${esc(row.action)} →</span></a>`,
          )
          .join("")
      : note("当前没有这类待办。");
  return (
    `<div class="page-title"><div><h1>工作总览</h1><p>从待处理的事情开始，不必逐个页面翻找。</p></div><div class="button-row">${can("edit") ? button("＋ 快速录入我方现货", () => quickIntake(), "primary") : ""}<a class="btn" href="#/items">查看商品库</a></div></div><div class="metrics">${cards.map((c) => `<a class="metric" href="${c.to}"><span>${c.label}</span><strong>${c.value}</strong><small>${c.sub}</small></a>`).join("")}</div>${onboarding}<div class="daily-columns">` +
    section(
      "现在优先处理",
      queueRows(urgent),
      '<a class="btn subtle" href="#/tasks">全部经营待办 →</a>',
    ) +
    section(
      "接下来处理",
      queueRows(next),
      queue.summary.total
        ? '<a class="btn subtle" href="#/tasks">查看完整队列 →</a>'
        : "",
    ) +
    `</div>` +
    section(
      "待确认商品资料",
      reviews.rows.length
        ? reviews.rows
            .map(
              (row) =>
                `<a class="action-row" href="${esc(row.href)}"><div><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></div><span>${esc(row.action)} →</span></a>`,
            )
            .join("")
        : note("当前没有待确认的商品资料。"),
      reviews.summary.total
        ? '<a class="btn subtle" href="#/tasks?scope=ITEM_REVIEW">查看全部待确认资料 →</a>'
        : "",
    )
  );
}
