import { request, can, esc, money, when, viewDialog } from "./core";
import {
  states,
  type Item,
  type Inquiry,
  type Sale,
  type Listing,
} from "./types";
export async function itemActivity(item: Item) {
  const back = encodeURIComponent(location.hash),
    filter = `itemId=${item.id}&page=1&size=5`,
    mode = item.dataMode === "TEST" ? "&dataMode=TEST" : "",
    saleEndpoint = can("finance") ? "/sales?" : "/sale-facts?";
  const [inquiries, sales, listings, costs] = await Promise.all([
    can("sell")
      ? request<{ rows: Inquiry[]; total: number }>("/inquiries?" + filter)
      : null,
    can("sell")
      ? request<{ rows: Sale[]; total: number }>(saleEndpoint + filter + mode)
      : null,
    request<{ rows: Listing[]; total: number }>("/listings?" + filter + mode),
    can("finance")
      ? request<
          {
            kind: string;
            amount: number;
            currency: string;
            note: string;
            status: string;
          }[]
        >(`/items/${item.id}/costs`)
      : null,
  ]);
  const full = (route: string, label: string) =>
    `<a class="btn" href="#/${route}?itemId=${item.id}${mode}&returnTo=${back}">${label}</a>`;
  viewDialog(
    `${item.code} · 经营记录`,
    (inquiries
      ? `<section><h3>客户询盘 · ${inquiries.total} 条</h3>${inquiries.rows.map((x) => `<p>${esc(x.customerRef)} · ${esc(x.channel)} · ${esc(states[x.state] || x.state)}<small>${esc(x.notes)}</small></p>`).join("")}${full("inquiries", "查看本商品全部询盘")}</section>`
      : "") +
      (sales
        ? `<section><h3>成交记录 · ${sales.total} 笔</h3>${sales.rows.map((x) => `<p>${when(x.soldAt)} · ${esc(x.customerRef || "未标记客户")} · ${esc(x.channel)}${can("finance") ? ` · ${money(x.amount, x.currency)}` : ""}</p>`).join("")}${full("sales", "查看本商品全部成交")}</section>`
        : "") +
      `<section><h3>远端身份记录 · ${listings.total} 条</h3>${listings.rows.map((x) => `<p>${esc(x.channel.name)} · ${esc(states[x.observed] || x.observed)}</p>`).join("")}${full("listings", "查看本商品全部远端身份记录")}</section>` +
      (costs
        ? `<section><h3>成本依据</h3>${costs.length ? costs.map((c) => `<p>${money(c.amount, c.currency)} · ${c.status === "ACTIVE" ? "有效" : "已作废"}<small>${esc(c.note)}</small></p>`).join("") : "<p>暂无成本依据</p>"}<a class="btn" href="#/items/${item.id}?tab=costs&returnTo=${back}">维护成本明细</a></section>`
        : ""),
  );
}
