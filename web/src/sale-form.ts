import { request, form, note, field, select, area, text } from "./core";
import type { Item, Channel } from "./types";
export const canRecordSale = (i: Item) =>
  !["SOLD", "GIFTED", "SELF_USE", "SUPPLIER_SOLD"].includes(i.status);
export async function recordSale(i: Item, after?: () => Promise<void>) {
  const channels = await request<Channel[]>("/channels");
  form(
    "登记已售出",
    note("先停止继续推广，成交金额和费用可以稍后补。此操作不会收款。") +
      select(
        "channel",
        "成交渠道",
        Object.fromEntries([
          ...channels.filter((c) => c.active).map((c) => [c.name, c.name]),
          ["线下成交", "线下成交"],
          ["其他渠道", "其他渠道"],
        ]),
      ) +
      field("customerRef", "客户内部标记（建议不用手机号）") +
      `<details class="full"><summary>外部订单、备注与例外依据</summary>${field("externalKey", "外部订单唯一键（建议 平台:账号:订单行ID）")}${select("intentId", "提前登记的例外意向", { "": "正常合作", ...Object.fromEntries(i.intents.filter((x) => x.status === "ACTIVE").map((x) => [x.id, x.customerRef + " · " + x.reason])) })}${area("note", "成交备注", "", 2)}</details>`,
    (d, k) =>
      request(
        `/items/${i.id}/sold`,
        "POST",
        {
          channel: text(d, "channel"),
          customerRef: text(d, "customerRef"),
          ...(text(d, "externalKey")
            ? { externalKey: text(d, "externalKey") }
            : {}),
          ...(text(d, "intentId") ? { intentId: text(d, "intentId") } : {}),
          note: text(d, "note"),
        },
        k,
      ),
    "确认已售出",
    after,
  );
}
