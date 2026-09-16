import { check, esc, form, note, request, select } from "./core";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Channel, Item } from "./types";

type ReadinessRow = {
  itemId: string;
  ready: boolean;
  missing: { code: string; title: string }[];
};

function confirmPlan(items: Item[], channel: Channel, rows: ReadinessRow[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ready = rows.filter((row) => row.ready);
  const blocked = rows.filter((row) => !row.ready);
  if (!ready.length)
    throw new Error("所选商品当前都未满足发布要求，请先处理缺项");
  form(
    "确认批量分发计划",
    note(
      `目标为 ${channel.name}：${ready.length} 件可生成冻结使用包并计划发布，${blocked.length} 件暂时阻断。不会调用外部平台；执行仍由分发 Agent 或人工回执完成。`,
    ) +
      `<ul>${blocked
        .map((row) => {
          const item = byId.get(row.itemId);
          return `<li>${esc(item ? `${item.code} ${item.title}` : row.itemId)}：${esc(row.missing.map((missing) => missing.title).join("；"))}</li>`;
        })
        .join("")}</ul>` +
      check("confirmed", `我已核对并确认计划 ${ready.length} 件商品`),
    async (data) => {
      if (!data.has("confirmed")) throw new Error("请先确认预检结果");
      setTimeout(
        () =>
          batchActions(
            "批量分发计划结果",
            ready.map((row) => {
              const item = byId.get(row.itemId)!;
              return {
                label: `${item.code} ${item.title}`,
                run: async (key: string) => {
                  const pack = await request<{ id: string }>(
                    `/items/${item.id}/packages`,
                    "POST",
                    {
                      channelId: channel.id,
                      purpose: "TRADE",
                      confirmed: true,
                    },
                    key,
                  );
                  return request(
                    "/distribution/plan",
                    "POST",
                    { packageId: pack.id, action: "PUBLISH" },
                    `${key}.plan`,
                  );
                },
              };
            }),
          ),
        0,
      );
      return { nextStep: true };
    },
    `确认生成 ${ready.length} 件计划`,
  );
}

export async function bulkDistributionPlan(items: Item[]) {
  const channels = (await request<Channel[]>("/channels")).filter(
    (channel) => channel.active,
  );
  if (!channels.length) throw new Error("请先创建并启用渠道账号");
  form(
    "批量生成分发计划",
    note(
      "先按目标渠道逐件执行统一 Readiness；通过的商品才会生成冻结使用包和 PUBLISH Attempt。图片、价格、批准资料与库存都会在提交时再校验。",
    ) +
      select(
        "channelId",
        "目标渠道账号",
        Object.fromEntries(
          channels.map((channel) => [channel.id, channel.name]),
        ),
      ),
    async (data) => {
      const channelId = String(data.get("channelId") || "");
      const channel = channels.find((row) => row.id === channelId);
      if (!channel) throw new Error("请选择有效渠道账号");
      const result = await request<{ rows: ReadinessRow[] }>(
        "/distribution/readiness",
        "POST",
        { channelId, itemIds: items.map((item) => item.id), purpose: "TRADE" },
      );
      setTimeout(() => confirmPlan(items, channel, result.rows), 0);
      return { nextStep: true };
    },
    "检查可发布商品",
  );
}
