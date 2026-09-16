import {
  request,
  can,
  me,
  esc,
  money,
  field,
  select,
  button,
  form,
  area,
  check,
  text,
  reload,
} from "./core";
import { onPageReady } from "./page-lifecycle";
import { recordPaging } from "./record-controls";
import { confirmedBatchActions as batchActions } from "./batch-actions";
import {
  orderCostBasisDialog,
  type POrder,
  type POrderRow,
  type PSource,
  type CostPreview,
} from "./procurement-page";
type Selected = { order: POrderRow; preview: CostPreview };
let scope = "",
  owner = "";
const selected = new Map<string, Selected>();
export async function costBatchPage() {
  if (!can("finance")) return "<p>确认成本需要财务权限。</p>";
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    p = new URLSearchParams();
  for (const k of ["q", "sourceId", "month", "page"]) {
    const v = qs.get(k);
    if (v) p.set(k, v);
  }
  const filter = new URLSearchParams(p);
  filter.delete("page");
  if (owner !== (me?.id || "") || scope !== filter.toString()) {
    selected.clear();
    owner = me?.id || "";
    scope = filter.toString();
  }
  const [sources, result] = await Promise.all([
    request<PSource[]>("/procurement/sources"),
    request<{ rows: POrderRow[]; total: number; page: number; size: number }>(
      "/procurement/orders?" + p,
    ),
  ]);
  const previews = await Promise.all(
    result.rows.map((o) =>
      request<CostPreview>(`/costing/orders/${o.id}/preview`),
    ),
  );
  const rows = result.rows.map((order, n) => ({ order, preview: previews[n] }));
  for (const r of rows)
    if (selected.has(r.order.id)) selected.set(r.order.id, r);
  const basis = (r: Selected) =>
    button("核对本单依据", async () => {
      const order = await request<POrder>(`/procurement/orders/${r.order.id}`);
      orderCostBasisDialog(order, reload, r.preview.paymentBreakdown);
    });
  const batchBasis = () => {
    if (!selected.size) throw new Error("请先选择订单");
    if (!p.get("sourceId") || !p.get("month"))
      throw new Error("批量填写汇率前，请先限定同一来源和采购月份");
    const orders = [...selected.values()];
    if (new Set(orders.map((r) => r.order.currency)).size !== 1)
      throw new Error("本批订单币种不一致，请分别确认汇率");
    const plans = new Map<string, Record<string, unknown>>();
    form(
      "批量确认本月汇率依据",
      `<p>只为尚无成本依据的订单填写本次明确确认的汇率。已有依据、有退款或退货的订单会保留原样并提示逐单核对。</p>${field("fx", "本月采用汇率", "", "text", true)}${area("note", "汇率来源与确认说明", "", 3)}${check("confirmed", "我已核对本月汇率，并确认按各来源已配置的每单附加成本执行")}`,
      async (d) => {
        const raw = text(d, "fx");
        if (
          !/^\d+(\.\d{1,6})?$/.test(raw) ||
          Number(raw) <= 0 ||
          Number(raw) > 100
        )
          throw new Error("请填写0至100之间的正汇率，最多6位小数");
        const note = text(d, "note");
        if (note.length < 3 || !d.has("confirmed"))
          throw new Error("请填写依据并勾选确认");
        const fxMicros = Math.round(Number(raw) * 1000000);
        setTimeout(
          () =>
            batchActions(
              "批量确认成本依据",
              orders.map((r) => ({
                label: r.order.externalOrderNo,
                run: async (key) => {
                  if (plans.has(r.order.id))
                    return request(
                      `/costing/orders/${r.order.id}/basis`,
                      "POST",
                      plans.get(r.order.id),
                      key,
                    );
                  const o = await request<POrder>(
                    `/procurement/orders/${r.order.id}`,
                  );
                  if (
                    o.version !== r.order.version ||
                    o.procurementSource.version !==
                      r.order.procurementSource.version
                  )
                    throw new Error("订单或来源规则已变化，请重新核对本批预览");
                  if (o.costBasis)
                    throw new Error(
                      "已有确认依据，已保留；需要调整时请逐单核对",
                    );
                  if (
                    o.returns.length ||
                    o.adjustments.some(
                      (a) =>
                        a.kind === "REFUND" ||
                        /refund|return|退款|退货/i.test(a.label) ||
                        (a.kind === "STORE_CREDIT" && a.amount > 0),
                    )
                  )
                    throw new Error(
                      "存在退款、Credit退回或退货线索，请逐单确认净支付",
                    );
                  if (
                    o.lines.some(
                      (l) =>
                        l.businessDecision !== "INCLUDE" ||
                        l.possession !== "IN_HAND" ||
                        !l.itemLink,
                    )
                  )
                    throw new Error(
                      "存在未确认、排除或未归入TM的商品，请先逐件核对",
                    );
                  const payload = {
                    version: 0,
                    mode: "CONFIRMED_FX",
                    fxMicros,
                    overheadCny: o.procurementSource.orderOverheadCny,
                    note,
                    confirmed: true,
                  };
                  plans.set(o.id, payload);
                  return request(
                    `/costing/orders/${o.id}/basis`,
                    "POST",
                    payload,
                    key,
                  );
                },
              })),
            ),
          0,
        );
        return { nextStep: true };
      },
      "确认并执行",
    );
  };
  const commit = () => {
    const chosen = [...selected.values()];
    if (!chosen.length) throw new Error("请先选择订单");
    form(
      "核对批量成本写入",
      `<p>仅提交预览可写入的订单；异常订单逐项说明原因。每单独立保留结果，重试不重复写入。</p>${chosen.map((r) => `<p>${esc(r.order.externalOrderNo)} · ${money(r.preview.totalCny, "CNY")} · ${r.preview.ready ? r.preview.rows.length + "件可写入" : esc(r.preview.blockers.join("；"))}</p>`).join("")}${check("confirmed", "我已逐单核对本批成本预览和依据")}`,
      async (d) => {
        if (!d.has("confirmed")) throw new Error("请先核对并确认");
        setTimeout(
          () =>
            batchActions(
              "批量写入成本结果",
              chosen.map((r) => ({
                label: r.order.externalOrderNo,
                run: async (key) => {
                  if (!r.preview.ready || !r.preview.basis)
                    throw new Error(
                      r.preview.blockers.join("；") || "请先核对成本依据",
                    );
                  return request(
                    `/costing/orders/${r.order.id}/commit`,
                    "POST",
                    { basisVersion: r.preview.basis.version, confirmed: true },
                    key,
                  );
                },
              })),
            ),
          0,
        );
        return { nextStep: true };
      },
      "确认并执行",
    );
  };
  onPageReady("cost-batch", (root, signal) => {
    const paint = () => {
      root.querySelector("[data-cost-count]")!.textContent =
        `已选 ${selected.size} 单（跨页保留，最多100单）`;
    };
    root.addEventListener(
      "change",
      (e) => {
        const b = e.target as HTMLInputElement;
        if (!b.dataset.costPick) return;
        if (b.checked && selected.size >= 100) {
          b.checked = false;
          return;
        }
        if (b.checked)
          selected.set(
            b.dataset.costPick,
            rows.find((r) => r.order.id === b.dataset.costPick)!,
          );
        else selected.delete(b.dataset.costPick);
        paint();
      },
      { signal },
    );
    root.querySelector("form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const next = new URLSearchParams({ mode: "costs" });
        for (const [k, v] of new FormData(e.currentTarget as HTMLFormElement)) {
          if (v) next.set(k, String(v));
        }
        location.hash = "/procurement?" + next;
      },
      { signal },
    );
    paint();
  });
  return `<div id="cost-batch"><a href="#/procurement">← 采购历史</a><div class="page-title"><div><h1>集中确认采购成本</h1><p>按来源和月份核对，先确认依据，再检查每单分摊。退款异常逐单处理。</p></div></div><form class="admin-filter-form">${field("q", "搜索订单", p.get("q") || "")}${select("sourceId", "采购来源", { "": "全部来源", ...Object.fromEntries(sources.map((s) => [s.id, s.name])) }, p.get("sourceId") || "")}${field("month", "采购月份", p.get("month") || "", "month")}<button class="btn primary">筛选</button></form><div class="button-row"><span data-cost-count></span>${button(
    "选择本页",
    () => {
      for (const r of rows) {
        if (selected.size >= 100) break;
        selected.set(r.order.id, r);
      }
      void reload();
    },
  )}${button("取消选择", () => {
    selected.clear();
    void reload();
  })}${button("批量确认汇率依据", batchBasis)}${button("批量写入TM成本", commit, "primary")}</div>${rows.map((r) => `<section class="panel"><div class="button-row"><label><input type="checkbox" data-cost-pick="${r.order.id}" aria-label="选择订单 ${esc(r.order.externalOrderNo)}" ${selected.has(r.order.id) ? "checked" : ""}>${esc(r.order.externalOrderNo)}</label><strong>${money(r.preview.totalCny, "CNY")}</strong>${basis(r)}<a class="btn" href="#/procurement/${r.order.id}?returnTo=${encodeURIComponent(location.hash)}">查看完整订单</a></div><p>${esc(r.order.procurementSource.name)} · ${r.preview.basis ? "依据版本 " + r.preview.basis.version : "依据待确认"} · 附加成本 ${money(r.preview.overheadCny ?? r.order.procurementSource.orderOverheadCny, "CNY")}</p>${r.preview.blockers.map((x) => `<p class="form-error">${esc(x)}</p>`).join("")}${r.preview.warnings.map((x) => `<p>${esc(x)}</p>`).join("")}<details><summary>查看逐件分摊 · ${r.preview.rows.length}件</summary>${r.preview.rows.map((x) => `<p>${esc(x.code)} · ${esc(x.title)} · ${money(x.totalCny, "CNY")}</p>`).join("")}</details></section>`).join("")}${!rows.length ? "<p>当前筛选没有订单，可调整来源或月份。</p>" : ""}${recordPaging("procurement", qs, result)}</div>`;
}
