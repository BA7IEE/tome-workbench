import { request, can, esc, section, note } from "./core";
type Queue = {
  total: number;
  rows: { id: string; title: string; detail: string; href: string; action: string }[];
};
export async function dailyWork() {
  const [counts, urgent, reviews] = await Promise.all([
    request<Record<string, number>>("/dashboard"),
    request<Queue>("/work-queue?scope=IMPORTANT&size=6"),
    request<Queue>("/work-queue?scope=ITEM_REVIEW&size=6"),
  ]);
  const rows = (queue: Queue) => queue.rows.length
    ? queue.rows.map(row => '<a class="action-row" href="' + esc(row.href) +
      '"><div><strong>' + esc(row.title) + "</strong><small>" + esc(row.detail) +
      "</small></div><span>" + esc(row.action) + " →</span></a>").join("")
    : note("当前没有这类待处理事项。");
  return '<div class="page-title"><div><h1>待处理</h1><p>每项直接回到对应商品处理；同一商品可能有多项。</p></div><a class="btn" href="#/items">回商品库</a></div>' +
    '<div class="button-row"><a class="btn primary" href="#/candidates">确认导入 · ' +
    counts.pendingCandidates + ' 条来源</a><a class="btn" href="#/tasks?scope=ITEM_REVIEW">确认商品资料 · ' +
    (counts.pendingItemReviews ?? reviews.total) + ' 件</a>' +
    (can("publish") ? '<a class="btn" href="#/distribution?scope=attention">上架异常 · ' + counts.pendingDistribution + " 项</a>" : "") +
    "</div>" + section("优先处理 · " + urgent.total + " 项", rows(urgent)) +
    section("继续整理资料", rows(reviews)) +
    '<p><a class="btn" href="#/tasks?scope=ALL">全部待处理 · ' + counts.actionable + " 项</a></p>";
}
