import { request, form, note, field, select, area, text } from "./core";
import type { Item, Channel } from "./types";
export const canRecordSale = (i: Item) =>
  !["SOLD", "GIFTED", "SELF_USE", "SUPPLIER_SOLD"].includes(i.status);
export async function recordSale(i: Item, after?: () => Promise<void>) {
  const channels = await request<Channel[]>("/channels");
  form(
    "登记已售出",
    note("确认后将商品标为已售并停止继续销售，不需要填写成本或费用。") +
      select(
        "channel",
        "成交渠道",
        Object.fromEntries([
          ...channels
            .filter((c) => c.active)
            .map((c) => [c.id, `${c.name}（已配置账号）`]),
          ["线下成交", "线下成交"],
          ["其他渠道", "其他渠道"],
        ]),
      ) +
      field("customerRef", "客户内部标记（建议不用手机号）") +
      `<details class="full"><summary>外部订单与备注</summary>${field("externalKey", "外部订单唯一键（建议 平台:账号:订单行ID）")}${area("note", "成交备注", "", 2)}</details>`,
    (d, k) => {
      const selected = text(d, "channel"),
        configured = channels.find((c) => c.id === selected);
      return request(
        `/items/${i.id}/sold`,
        "POST",
        {
          channel: configured?.name || selected,
          ...(configured ? { channelId: configured.id } : {}),
          customerRef: text(d, "customerRef"),
          ...(text(d, "externalKey")
            ? { externalKey: text(d, "externalKey") }
            : {}),
          note: text(d, "note"),
        },
        k,
      );
    },
    "确认已售出",
    after,
  );
}
