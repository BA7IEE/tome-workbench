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
import type { Item, Channel } from "./types";
export async function recordInquiry(i: Item, after?: () => Promise<void>) {
  const channels = (await request<Channel[]>("/channels")).filter(
    (c) => c.active,
  );
  const choices = Object.fromEntries([
    ...channels.map((c) => [c.name, c.name]),
    ["线下沟通", "线下沟通"],
    ["OTHER", "其他渠道"],
  ]);
  form(
    "记录询盘",
    select("channel", "渠道", choices) +
      field(
        "channelOther",
        "其他渠道名称（仅选择“其他渠道”时填写）",
        "",
        "text",
        false,
        'placeholder="例如 WhatsApp / Instagram"',
      ) +
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
    (d, k) => {
      const selected = text(d, "channel"),
        other = text(d, "channelOther").trim(),
        channel = selected === "OTHER" ? other : selected;
      if (!channel) throw new Error("请填写实际询盘渠道");
      return request(
        "/inquiries",
        "POST",
        {
          itemId: i.id,
          channel,
          customerRef: text(d, "customerRef"),
          quote: cents(d.get("quote")),
          currency: text(d, "currency"),
          notes: text(d, "notes"),
        },
        k,
      );
    },
    "保存询盘",
    after,
  );
}
