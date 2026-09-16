import { area, cents, check, form, note, request, select, text } from "./core";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Channel, Item } from "./types";
import { currencies } from "./core";

function parseRows(value: string, items: Item[]) {
  const byCode = new Map(items.map((item) => [item.code.toUpperCase(), item]));
  const rows = new Map<Item, number>();
  for (const [lineNumber, line] of value.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    const item = byCode.get(parts[0].toUpperCase());
    if (!item)
      throw new Error(`第 ${lineNumber + 1} 行的 ${parts[0]} 不在当前选择中`);
    if (parts.length === 1)
      throw new Error(
        `第 ${lineNumber + 1} 行的 ${item.code} 尚未填写金额；请填写明确金额或删除本行`,
      );
    if (parts.length !== 2)
      throw new Error(`第 ${lineNumber + 1} 行应为“TM编号 金额”`);
    if (rows.has(item)) throw new Error(`${item.code} 重复出现`);
    rows.set(item, cents(parts[1])!);
  }
  if (!rows.size) throw new Error("请至少粘贴一条渠道价");
  return [...rows.entries()].map(([item, amount]) => ({ item, amount }));
}

export async function bulkChannelPrices(items: Item[]) {
  const channels = (await request<Channel[]>("/channels")).filter(
    (channel) => channel.active,
  );
  if (!channels.length) throw new Error("请先创建并启用渠道账号");
  const first = channels[0];
  form(
    "批量设置渠道价格",
    note(
      "渠道价覆盖此渠道上的默认 Item 报价，不会修改成本或其他渠道。粘贴格式为每行“TM000123 1380”；没有默认报价的商品会保留 TM 编号但不填零，须填写明确金额或删除该行。写入不做实时汇率换算。",
    ) +
      select(
        "channelId",
        "目标渠道账号",
        Object.fromEntries(
          channels.map((channel) => [channel.id, channel.name]),
        ),
        first.id,
      ) +
      select("currency", "币种", currencies, first.defaultCurrency) +
      area(
        "rows",
        "渠道价格",
        items
          .map((item) =>
            item.currentPrice === null
              ? item.code
              : `${item.code} ${item.currentPrice / 100}`,
          )
          .join("\n"),
        10,
      ) +
      check("confirmed", "我已逐件核对渠道、币种和金额"),
    async (data) => {
      if (!data.has("confirmed")) throw new Error("请先确认渠道价格");
      const rows = parseRows(text(data, "rows"), items);
      const channelId = text(data, "channelId");
      const currency = text(data, "currency");
      setTimeout(
        () =>
          batchActions(
            "渠道价格写入结果",
            rows.map((row) => ({
              label: `${row.item.code} · ${currency} ${(row.amount / 100).toFixed(2)}`,
              run: (key: string) =>
                request(
                  `/items/${row.item.id}/channel-prices/${channelId}`,
                  "POST",
                  { amount: row.amount, currency },
                  key,
                ),
            })),
          ),
        0,
      );
      return { nextStep: true };
    },
    "确认写入渠道价",
  );
}
