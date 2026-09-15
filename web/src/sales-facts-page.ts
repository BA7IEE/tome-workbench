import { request, esc, when, table, section, note } from "./core";
import { recordFilters, recordContext, recordPaging } from "./record-controls";
import { states } from "./types";

type SaleFact = {
  id: string;
  itemId: string;
  code: string;
  item: { serial: number; title: string };
  version: number;
  channel: string;
  customerRef: string;
  state: string;
  returned: boolean;
  soldAt: string;
  externalKey?: string | null;
};

export async function salesFactsPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const result = await request<{
    rows: SaleFact[];
    total: number;
    page: number;
    size: number;
    financialVisible: false;
  }>("/sale-facts?" + new URLSearchParams({
    page: qs.get("page") || "1",
    size: "50",
    ...(qs.get("id") ? { id: qs.get("id")! } : {}),
    ...(qs.get("itemId") ? { itemId: qs.get("itemId")! } : {}),
    ...(qs.get("q") ? { q: qs.get("q")! } : {}),
    ...(qs.get("channel") ? { channel: qs.get("channel")! } : {}),
    ...(qs.get("customer") ? { customer: qs.get("customer")! } : {}),
    ...(qs.get("dateFrom") ? { dateFrom: qs.get("dateFrom")! } : {}),
    ...(qs.get("dateTo") ? { dateTo: qs.get("dateTo")! } : {}),
  }));
  const rows = result.rows;
  return (
    recordFilters("sales", qs, "sales") +
    recordContext(qs, "sales") +
    section(
      "成交记录",
      note(
        "这里显示你有权限处理的成交事实。成交额、成本、费用、退款、到账和合作分成只向经营财务角色显示。",
      ) +
        table(
          ["商品 / 时间", "渠道 / 客户", "成交状态", "外部订单"],
          rows.map((s) => [
            `<a class="itemlink" href="#/items/${esc(s.itemId)}/edit">${esc(s.code + " " + s.item.title)}</a><small>${when(s.soldAt)}</small>`,
            `${esc(s.channel)}<small>${esc(s.customerRef || "未标记客户")}</small>`,
            `${esc(states[s.state] || s.state || "已登记")}<small>${s.returned ? "已完好回收" : "成交已记录"}</small>`,
            esc(s.externalKey || "未记录"),
          ]),
        ),
    ) +
    recordPaging("sales", qs, result) +
    (!rows.length
      ? '<p><a class="btn" href="#/items">回到商品库登记成交</a></p>'
      : "")
  );
}
