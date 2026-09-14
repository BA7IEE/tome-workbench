import {
  request,
  esc,
  form,
  field,
  area,
  check,
  note,
  button,
  when,
  dialog,
} from "./core";
import { catalogContext, clearEditQueue } from "./catalog-context";
import type { Item } from "./types";
interface Impact {
  id: string;
  code: string;
  title: string;
  version: number;
  dataMode: string;
  digest: string;
  sales: { id: string }[];
  costs: { id: string }[];
  reservations: { id: string }[];
  listings: { id: string; url: string; channel: { name: string } }[];
  statements: {
    id: string;
    status: string;
    currency: string;
    periodStart: string;
    periodEnd: string;
  }[];
}
export async function cleanupTestData(
  item: Pick<Item, "id" | "code" | "title">,
) {
  const p = await request<Impact>(`/items/${item.id}/test-cleanup-preview`),
    confirmed = p.statements.filter((s) => s.status === "CONFIRMED");
  const body =
    `<div class="notice warning"><strong>${esc(p.code)} · ${esc(p.title)}</strong><p>仅清理模拟记录。真实交易或真实外部发布不能使用此入口。</p></div>` +
    `<dl class="details"><div><dt>模拟成交 / 退款</dt><dd>${p.sales.length}笔关联成交</dd></div><div><dt>成本记录</dt><dd>${p.costs.length}条</dd></div><div><dt>预留及发布</dt><dd>${p.reservations.length}条预留，${p.listings.length}条发布</dd></div></dl>` +
    note(
      "清理后移入回收站并排除正式统计，关联成交、退款、费用及原图仍保留。这不是退款或平台下架操作。",
    ) +
    (confirmed.length
      ? `<div class="notice warning"><strong>涉及${confirmed.length}份已确认对账</strong>` +
        confirmed
          .map(
            (s) =>
              `<p>${esc(s.currency)} · ${when(s.periodStart)} — ${when(s.periodEnd)}</p>` +
              button("查看对账影响", () => {
                dialog.close();
                location.hash = "/settlements/" + s.id;
              }),
          )
          .join("") +
        "<p>原快照不会被修改，隔离后需要另行生成更正。</p></div>"
      : "") +
    field("typedCode", "输入商品编号确认", "", "text", true) +
    area(
      "reason",
      "确认为测试数据的原因",
      "试用系统时创建的模拟记录，没有真实交易",
      3,
    ) +
    check(
      "noRealTransaction",
      "我确认关联成交、费用和退款仅为测试，没有真实交易和资金往来",
    ) +
    check(
      "noRealPublication",
      "我确认没有仍在对外销售的真实商品，关联发布记录仅为测试",
    ) +
    (confirmed.length
      ? check(
          "acknowledgeStatements",
          "我已查看对账影响，理解历史快照保留且需要另行更正",
        )
      : "");
  form(
    "清理测试商品及模拟记录",
    body,
    async (d, key) => {
      if (!d.has("noRealTransaction") || !d.has("noRealPublication"))
        throw new Error("请核对并确认两项测试数据声明");
      const result = await request(
        `/items/${item.id}/test-cleanup`,
        "POST",
        {
          version: p.version,
          digest: p.digest,
          typedCode: String(d.get("typedCode") || ""),
          reason: String(d.get("reason") || ""),
          noRealTransaction: true,
          noRealPublication: true,
          acknowledgeStatements: d.has("acknowledgeStatements"),
        },
        key,
      );
      catalogContext().selected.delete(item.id);
      clearEditQueue();
      return result;
    },
    "确认清理测试数据",
  );
}
