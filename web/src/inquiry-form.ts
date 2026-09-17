import {
  form,
  field,
  select,
  area,
  currencies,
  dialog,
  request,
  text,
  cents,
} from "./core";
import type { Item, Channel } from "./types";

type ChannelPrice = {
  channelId: string;
  amount: number;
  currency: string;
  active: boolean;
};

function channelCurrency(channel: Channel) {
  if (channel.platform === "ANQICMS") return "USD";
  if (channel.platform === "XIANYU") return "CNY";
  return channel.defaultCurrency;
}

export async function recordInquiry(i: Item, after?: () => Promise<void>) {
  const [allChannels, prices] = await Promise.all([
    request<Channel[]>("/channels"),
    request<ChannelPrice[]>(`/items/${i.id}/channel-prices`),
  ]);
  const channels = allChannels.filter((c) => c.active);
  const byChannel = new Map(
    prices
      .filter((price) => price.active)
      .map((price) => [price.channelId, price]),
  );
  const choices = Object.fromEntries([
    ...channels.map((c) => [c.id, `${c.name}（已配置账号）`]),
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
        configured = channels.find((c) => c.id === selected),
        other = text(d, "channelOther").trim(),
        channel = selected === "OTHER" ? other : configured?.name || selected;
      if (!channel) throw new Error("请填写实际询盘渠道");
      return request(
        "/inquiries",
        "POST",
        {
          itemId: i.id,
          channel,
          ...(configured ? { channelId: configured.id } : {}),
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
  const channel = dialog.querySelector<HTMLSelectElement>('[name="channel"]');
  const quote = dialog.querySelector<HTMLInputElement>('[name="quote"]');
  const currency = dialog.querySelector<HTMLSelectElement>('[name="currency"]');
  const sync = () => {
    const configured = channels.find((row) => row.id === channel?.value);
    if (!quote || !currency) return;
    if (!configured) {
      currency.value = i.currency;
      quote.value = "";
      return;
    }
    const targetCurrency = channelCurrency(configured);
    const override = byChannel.get(configured.id);
    const amount = override
      ? override.currency === targetCurrency
        ? override.amount
        : null
      : i.currency === targetCurrency
        ? i.currentPrice
        : null;
    currency.value = targetCurrency;
    quote.value = amount === null ? "" : String(amount / 100);
  };
  channel?.addEventListener("change", sync);
  sync();
}
