import {
  form,
  field,
  select,
  area,
  currencies,
  request,
  text,
  cents,
} from "./core";
import type { Item } from "./types";
export function recordInquiry(i: Item, after?: () => Promise<void>) {
  form(
    "记录询盘",
    field("channel", "渠道", "", "text", true) +
      field("customerRef", "客户内部标记", "", "text", true) +
      field(
        "quote",
        "报价（可留空）",
        "",
        "text",
        false,
        'inputmode="decimal"',
      ) +
      select("currency", "币种", currencies, i.currency) +
      area("notes", "问题、跟进计划与沟通摘要"),
    (d, k) =>
      request(
        "/inquiries",
        "POST",
        {
          itemId: i.id,
          channel: text(d, "channel"),
          customerRef: text(d, "customerRef"),
          quote: cents(d.get("quote")),
          currency: text(d, "currency"),
          notes: text(d, "notes"),
        },
        k,
      ),
    "保存询盘",
    after,
  );
}
