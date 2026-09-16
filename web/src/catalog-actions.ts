import { exportMaterials } from "./materials";
import { beginCollection } from "./collection-builder";
import { bulkPrices } from "./bulk-prices";
import { bulkDictionaries } from "./bulk-dictionaries";
import { deleteProducts } from "./recycle-bin";
import { request, can, area, field, select, form, note } from "./core";
import { beginEditQueue, saveListScroll } from "./catalog-context";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import type { Item, Channel } from "./types";
import { states, categories } from "./types";
export type CatalogAction = {
  label: string;
  run: () => unknown;
  danger?: boolean;
  primary?: boolean;
};
function downloadCsv(rows: Item[]) {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const body = [
    [
      "商品编号",
      "名称",
      "品牌",
      "品类",
      "状态",
      "实物持有",
      "位置",
      "币种",
      "对外报价",
      "发布资料审核",
    ],
    ...rows.map((i) => [
      i.code,
      i.title,
      i.brand,
      categories[i.category],
      states[i.status],
      i.ownership === "OWN" ? "我方持有" : "供应商持有",
      i.location,
      i.currency,
      i.currentPrice == null ? "" : (i.currentPrice / 100).toFixed(2),
      i.approvedValid ? "已确认" : "待确认",
    ]),
  ]
    .map((r) => r.map(safe).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "兔泥巴商品清单.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function catalogActions(chosen: () => Item[]): CatalogAction[] {
  const actions: CatalogAction[] = [
    {
      label: "下载商品资料",
      primary: true,
      run: () => exportMaterials(chosen()),
    },
    { label: "导出清单", run: () => downloadCsv(chosen()) },
  ];
  if (can("edit"))
    actions.push(
      {
        label: "逐件编辑",
        run: () => {
          const ids = chosen().map((i) => i.id);
          beginEditQueue(ids);
          saveListScroll();
          location.hash = `/items/${ids[0]}/edit`;
        },
      },
      { label: "批量定价", run: () => bulkPrices(chosen()) },
      { label: "批量修改属性", run: () => bulkDictionaries(chosen()) },
      {
        label: "批量修改位置",
        run: () => {
          const list = chosen();
          form(
            "批量登记位置与保管人",
            note(
              `将为所选${list.length}件分别记录交接，有冲突的商品不会被覆盖。`,
            ) +
              field("to", "新位置或保管人", "", "text", true) +
              area("evidence", "本次交接依据", "", 2),
            async (d) => {
              const to = String(d.get("to") || ""),
                evidence = String(d.get("evidence") || "").trim();
              if (!evidence) throw new Error("请填写交接依据");
              setTimeout(
                () =>
                  batchActions(
                    "商品位置更新",
                    list.map((i) => ({
                      label: i.code + " " + i.title,
                      run: (key) =>
                        request(
                          `/items/${i.id}/move`,
                          "POST",
                          { version: i.version, to, evidence },
                          key,
                        ),
                    })),
                  ),
                0,
              );
              return { nextStep: true };
            },
          );
        },
      },
      {
        label: "检查发布缺项",
        run: async () => {
          const channels = await request<Channel[]>("/channels"),
            choices = Object.fromEntries(
              channels.filter((c) => c.active).map((c) => [c.id, c.name]),
            );
          if (!Object.keys(choices).length)
            throw new Error("先在设置中添加常用渠道");
          const list = chosen();
          form(
            "按用途安排补资料",
            select("channelId", "目标渠道", choices),
            async (d) => {
              const channelId = String(d.get("channelId"));
              setTimeout(
                () =>
                  batchActions(
                    "检查与安排工作",
                    list.map((i) => ({
                      label: i.code + " " + i.title,
                      run: (key) =>
                        request(
                          `/items/${i.id}/prepare`,
                          "POST",
                          { channelId, purpose: "TRADE" },
                          key,
                        ),
                    })),
                  ),
                0,
              );
              return { nextStep: true };
            },
          );
        },
      },
    );
  if (can("publish"))
    actions.push({
      label: "创建客户选品",
      run: () => beginCollection(chosen()),
    });
  if (can("sell"))
    actions.push({
      label: "批量暂停推广",
      run: () => {
        const list = chosen();
        form(
          "暂停所选商品推广",
          note(
            "不会把商品标记成已售，不会产生收入；已经发布的渠道仍需完成下架回执。",
          ) + area("reason", "暂停原因", "", 2),
          async (d) => {
            const reason = String(d.get("reason") || "").trim();
            if (!reason) throw new Error("请填写原因");
            setTimeout(
              () =>
                batchActions(
                  "暂停推广结果",
                  list.map((i) => ({
                    label: i.code + " " + i.title,
                    run: (key) =>
                      request(
                        `/items/${i.id}/state`,
                        "POST",
                        { state: "PAUSED", reason },
                        key,
                      ),
                  })),
                ),
              0,
            );
            return { nextStep: true };
          },
        );
      },
    });
  if (can("delete"))
    actions.push({
      label: "批量删除",
      danger: true,
      run: () => deleteProducts(chosen()),
    });
  return actions;
}
