import { area, check, form, note, request, select } from "./core";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Channel, Item } from "./types";

function tradeChannels(channels: Channel[]) {
  return channels.filter(
    (channel) => channel.active && channel.businessPurpose === "TRADE",
  );
}

/**
 * Records a current business intention only. It deliberately does not create a
 * package, a DistributionAttempt, a Listing, or an external platform action.
 */
export async function addDistributionTargets(items: Item[]) {
  const channels = tradeChannels(await request<Channel[]>("/channels"));
  if (!channels.length) throw new Error("请先创建并启用交易用途的渠道账号");
  form(
    "加入分发渠道",
    note(
      `将为所选 ${items.length} 件商品记录当前希望经营的交易渠道。此动作不是发布预检，不生成冻结使用包或分发记录，也不会调用外部平台；商品即使尚未批准、缺图或不可售，也可以先明确经营意图。`,
    ) +
      select(
        "channelId",
        "交易渠道账号",
        Object.fromEntries(
          channels.map((channel) => [channel.id, channel.name]),
        ),
      ) +
      area("reason", "经营意图说明", "", 3) +
      check(
        "duplicatePlatformConfirmed",
        "如系统提示同平台已有其他账号目标，我明确确认要同时经营",
      ) +
      check("confirmed", `我已核对并确认加入该渠道的 ${items.length} 件商品`),
    async (data) => {
      const channelId = String(data.get("channelId") || "");
      const reason = String(data.get("reason") || "").trim();
      if (!channelId) throw new Error("请选择交易渠道账号");
      if (!reason) throw new Error("请填写经营意图说明");
      if (!data.has("confirmed")) throw new Error("请先确认本次经营意图");
      setTimeout(
        () =>
          batchActions(
            "加入分发渠道结果",
            items.map((item) => ({
              label: `${item.code} ${item.title}`,
              run: (key) =>
                request(
                  `/items/${item.id}/distribution-targets/${channelId}`,
                  "POST",
                  {
                    active: true,
                    reason,
                    duplicatePlatformConfirmed: data.has(
                      "duplicatePlatformConfirmed",
                    ),
                  },
                  key,
                ),
            })),
          ),
        0,
      );
      return { nextStep: true };
    },
    `确认加入 ${items.length} 件商品`,
  );
}
