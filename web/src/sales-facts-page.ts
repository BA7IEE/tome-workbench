import { request, esc, when, table, section, note, can, button, reload } from "./core";
import { receiveStockReturn } from "./stock-return";
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
  inventoryReturned: boolean;
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
  }>(
    "/sale-facts?" +
      new URLSearchParams({
        page: qs.get("page") || "1",
        size: "50",
        ...(qs.get("id") ? { id: qs.get("id")! } : {}),
        ...(qs.get("itemId") ? { itemId: qs.get("itemId")! } : {}),
        ...(qs.get("q") ? { q: qs.get("q")! } : {}),
        ...(qs.get("channel") ? { channel: qs.get("channel")! } : {}),
        ...(qs.get("customer") ? { customer: qs.get("customer")! } : {}),
        ...(qs.get("dateFrom") ? { dateFrom: qs.get("dateFrom")! } : {}),
        ...(qs.get("dateTo") ? { dateTo: qs.get("dateTo")! } : {}),
      }),
  );
  const rows = result.rows;
  return (
    recordFilters("sales", qs, "sales") +
    recordContext(qs, "sales") +
    section(
      "成交记录",
      note(
        "这里只记录哪件商品在何时售出；标记售出后停止继续销售，不需要补账。",
      ) +
        table(
          ["商品 / 时间", "渠道 / 客户", "成交状态", "外部订单", ...(can("finance") ? ["实物回收"] : [])],
          rows.map((s) => [
            `<a class="itemlink" href="#/items/${esc(s.itemId)}?returnTo=${encodeURIComponent(location.hash)}">${esc(s.code + " " + s.item.title)}</a><small>${when(s.soldAt)}</small>`,
            `${esc(s.channel)}<small>${esc(s.customerRef || "未标记客户")}</small>`,
            `${esc(states[s.state] || s.state || "已登记")}<small>${s.inventoryReturned ? "实物已完整回收" : "成交已记录"}</small>`,
            esc(s.externalKey || "未记录"),
            ...(can("finance") ? [s.inventoryReturned ? "已回收" : button("确认实物退回", () => receiveStockReturn({ saleId: s.id }, reload))] : []),
          ]),
        ),
    ) +
    recordPaging("sales", qs, result) +
    (!rows.length
      ? '<p><a class="btn" href="#/items">回到商品库登记成交</a></p>'
      : "")
  );
}
