import {
  form,
  field,
  select,
  currencies,
  money,
  esc,
  check,
  cents,
  request,
} from "./core";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Item } from "./types";
export function bulkPrices(items: Item[]) {
  form(
    "批量定价",
    `<p class="full">逐件填写拟售价，只有发生变化的商品会提交。留空表示暂不报价；人民币成本仅供参考，不自动决定售价。</p><div class="full table-wrap bulk-price-table"><table><thead><tr><th>商品</th><th>取得成本</th><th>拟售价</th><th>币种</th></tr></thead><tbody>${items.map((i) => `<tr><td>${i.assets[0]?.id ? `<img class="record-thumb" src="/api/assets/${i.assets[0]?.id}/preview" alt="${esc(i.title)}">` : ""}<strong>${esc(i.code)}</strong><small>${esc(i.title)}</small></td><td>${money(i.currentCostCny ?? null, "CNY")}</td><td>${field("price_" + i.id, "拟售价 " + i.code, i.currentPrice == null ? "" : i.currentPrice / 100, "text", false, 'inputmode="decimal"')}</td><td>${select("currency_" + i.id, "币种 " + i.code, currencies, i.currency)}</td></tr>`).join("")}</tbody></table></div>` +
      check("confirmed", "我已逐件核对以上售价与币种"),
    async (d) => {
      if (!d.has("confirmed")) throw new Error("请先核对售价与币种");
      const rows = items
        .map((i) => ({
          i,
          price: cents(d.get("price_" + i.id)),
          currency: String(d.get("currency_" + i.id)),
        }))
        .filter(
          (r) => r.price !== r.i.currentPrice || r.currency !== r.i.currency,
        );
      if (!rows.length) throw new Error("尚未修改任何价格");
      setTimeout(
        () =>
          batchActions(
            "批量定价结果",
            rows.map((r) => ({
              label: r.i.code + " · " + money(r.price, r.currency),
              run: (key) =>
                request(
                  `/items/${r.i.id}`,
                  "PATCH",
                  {
                    version: r.i.version,
                    currentPrice: r.price,
                    currency: r.currency,
                  },
                  key,
                ),
            })),
          ),
        0,
      );
      return { nextStep: true };
    },
    "确认并执行",
  );
}
