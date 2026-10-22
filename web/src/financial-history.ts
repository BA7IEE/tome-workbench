import { request, esc, money, when, table, section, note, button, downloadJson } from "./core";
import { recordFilters, recordParams, recordPaging } from "./record-controls";
import { states, type Sale } from "./types";

/** Historical money remains readable under its original permission, without a daily ledger workflow. */
export async function financialHistoryPage(id?: string, statements = false) {
  if (statements) {
    if (id) {
      const record = await request<Record<string, unknown>>("/settlements/" + id);
      return section("历史对账快照（只读）",
        '<a class="btn" href="#/settlements">返回历史快照</a>' +
        note("保留原始快照供查阅与恢复，不要求补账或生成新的结算。") +
        "<pre class=\"copy\">" + esc(JSON.stringify(record, null, 2)) + "</pre>",
        button("下载原始快照", () => downloadJson("历史对账快照.json", record)));
    }
    const rows = await request<{ id: string; createdAt: string; currency: string; status: string }[]>("/settlements");
    return section("历史对账快照（只读）", table(["记录时间", "币种", "原状态", "查看"],
      rows.map(row => [when(row.createdAt), esc(row.currency), esc(states[row.status] || row.status),
        '<a href="#/settlements/' + row.id + '">查看快照</a>'])));
  }
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const result = await request<{ rows: Sale[]; total: number; page: number; size: number }>(
    "/sales?" + recordParams(qs));
  return '<p><a class="btn" href="#/settings">返回设置</a> <a class="btn" href="#/settlements">历史对账快照</a></p>' +
    note("此处只读保留历史金额。商品入库、修改、上架和标记售出均不需要记账，也不会催补成本、费用或到账。") +
    (qs.get("dataMode") === "TEST" ? note("模拟历史记录，不计入正式商品或销售统计。") : "") +
    recordFilters("financial-history", qs, "sales") +
    section("历史账务（只读）", table(["商品 / 时间", "成交额", "原成本", "原费用", "原退款"],
      result.rows.map(row => [
        '<a href="#/items/' + row.itemId + '?tab=history">' + esc(row.code + " " + row.item.title) + "</a><small>" + when(row.soldAt) + "</small>",
        money(row.amount, row.currency), money(row.cost, row.currency),
        money(row.fees, row.currency), money(row.refunded, row.currency),
      ])),
      button("下载当前历史记录", () => downloadJson("历史账务.json", result))) +
    recordPaging("financial-history", qs, result);
}
