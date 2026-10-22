import { safeReturn } from "./record-controls";
import { showSourceEvidence } from "./source-evidence";
import {
  request,
  can,
  esc,
  button,
  field,
  select,
  area,
  form,
  note,
  table,
  money,
  when,
  text,
  toast,
  reload,
} from "./core";
import { onPageReady } from "./page-lifecycle";
import { currencies } from "./core";

export type PSource = {
  id: string;
  code: string;
  name: string;
  kind: string;
  defaultCurrency: string;
  active: boolean;
  version: number;
  orderOverheadCny: number;
  costAllocationMethod: string;
  storeCreditAsPayment: boolean;
  supplier?: { id: string; name: string } | null;
  _count?: { orders: number };
};
export type POrderRow = {
  id: string;
  version: number;
  externalOrderNo: string;
  orderedAt: string | null;
  sourceStatusRaw: string;
  returnabilityRaw: string;
  currency: string;
  subtotalAmount: number | null;
  totalAmount: number | null;
  paymentAmount: number | null;
  procurementSource: PSource;
  _count: { lines: number; shipments: number; returns: number };
};
type PLine = {
  ingestCandidates?: { id: string; assets: { id: string }[] }[];
  id: string;
  version: number;
  lineKey: string;
  sourceSku: string;
  title: string;
  brandRaw: string;
  categoryRaw: string;
  productUrl: string;
  currency: string;
  lineAmount: number | null;
  sourceLineNetAmount: number | null;
  sourceCurrentPrice: number | null;
  sourceEstimatedRetail: number | null;
  sourceConditionRaw: string;
  sourceStatusRaw: string;
  sizeLabelRaw: string;
  colorRaw: string;
  materialRaw: string;
  measurements: unknown;
  measurementsEstimated: boolean;
  descriptionRaw: string;
  imageUrls: string[];
  businessDecision: string;
  possession: string;
  reviewNote: string;
  itemLink?: {
    item: { id: string; serial: number; title: string; brand: string };
  } | null;
  sourceCandidate?: { id: string; sourceKey: string; title: string } | null;
};
export type POrder = POrderRow & {
  adjustments: {
    id: string;
    adjustmentKey: string;
    kind: string;
    label: string;
    amount: number;
    currency: string;
  }[];
  lines: PLine[];
  shipments: {
    id: string;
    shipmentKey: string;
    externalShipmentRef: string;
    carrier: string;
    statusRaw: string;
    lines: { lineId: string }[];
  }[];
  returns: {
    id: string;
    returnKey: string;
    externalReturnRef: string;
    statusRaw: string;
    lines: { lineId: string }[];
  }[];
  revisions: { version: number; createdAt: string }[];
};

const decisions: Record<string, string> = {
  UNDECIDED: "待核对", INCLUDE: "纳入经营", EXCLUDE: "排除",
};
const possessions: Record<string, string> = {
  UNKNOWN: "未知", IN_HAND: "实物在手", NOT_IN_HAND: "不在手",
};
const sourceKinds: Record<string, string> = {
  MARKETPLACE: "采购平台",
  SUPPLIER: "供应商",
  OFFLINE: "线下采购",
  OTHER: "其他来源",
};
const adjustmentKinds: Record<string, string> = {
  SHIPPING: "运费",
  DISCOUNT: "折扣",
  STORE_CREDIT: "抵用余额",
  TAX: "税费",
  FEE: "其他费用",
  REFUND: "退款",
  OTHER: "其他",
};
function sourceDialog(after: () => Promise<void>) {
  form(
    "新增采购来源",
    field("code", "来源编码", "", "text", true, 'placeholder="例如 TRR"') +
      field(
        "name",
        "来源名称",
        "",
        "text",
        true,
        'placeholder="例如 The RealReal"',
      ) +
      select("kind", "来源类型", sourceKinds, "MARKETPLACE") +
      select("defaultCurrency", "默认币种", currencies, "CNY") +
      area("notes", "内部说明", "", 3),
    (d, k) =>
      request(
        "/procurement/sources",
        "POST",
        {
          code: text(d, "code").trim().toUpperCase(),
          name: text(d, "name"),
          kind: text(d, "kind"),
          defaultCurrency: text(d, "defaultCurrency"),
          notes: text(d, "notes"),
        },
        k,
      ),
    "保存来源",
    after,
  );
}

function sourceMetadataDialog(source: PSource, after: () => Promise<void>) {
  form(
    "调整采购来源默认币种",
    note(
      `正在调整 ${source.name}（${source.code}）的默认币种。它只用于后续未显式传入币种的候选；不会改写既有订单、候选、TM、库存或成本。`,
    ) +
      select("defaultCurrency", "默认币种", currencies, source.defaultCurrency) +
      area("reason", "更正依据", "", 3),
    (d, k) =>
      request(
        `/procurement/sources/${source.id}/metadata`,
        "POST",
        {
          version: source.version,
          defaultCurrency: text(d, "defaultCurrency"),
          reason: text(d, "reason"),
        },
        k,
      ),
    "保存默认币种",
    after,
  );
}

function lineReviewDialog(line: PLine, after: () => Promise<void>) {
  form(
    "核对实物与经营去向",
    note(
      "平台状态只作为来源事实。请根据手中实物和真实经营计划选择，不会因 Shipped / Sold 自动改变库存。",
    ) +
      select("businessDecision", "经营处理", decisions, line.businessDecision) +
      select("possession", "实物情况", possessions, line.possession) +
      area("reviewNote", "核对说明", line.reviewNote || "", 3),
    (d, k) =>
      request(
        `/procurement/lines/${line.id}/review`,
        "POST",
        {
          version: line.version,
          businessDecision: text(d, "businessDecision"),
          possession: text(d, "possession"),
          reviewNote: text(d, "reviewNote"),
        },
        k,
      ),
    "保存核对",
    after,
  );
}
function linkItemDialog(line: PLine, after: () => Promise<void>) {
  form(
    "关联已有TM商品",
    note("仅在确认这是同一件实物时关联。来源订单行会保留，不会覆盖商品资料。") +
      field("code", "TM编号", "", "text", true, 'placeholder="例如 TM000123"') +
      area("note", "关联依据", "", 2),
    async (d, k) => {
      const code = text(d, "code").trim().toUpperCase();
      if (!/^TM\d{6,}$/.test(code)) throw new Error("请输入完整TM编号");
      const found = await request<{
        rows: { id: string; code: string; title: string }[];
        total: number;
      }>(`/items?q=${encodeURIComponent(code)}&dataMode=ALL`);
      const item = found.rows.find((x) => x.code === code);
      if (!item) throw new Error("没有找到该TM商品");
      return request(
        `/procurement/lines/${line.id}/link-item`,
        "POST",
        { itemId: item.id, note: text(d, "note") },
        k,
      );
    },
    "确认关联",
    after,
  );
}
const fact = (label: string, value: unknown) =>
  `<div><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;
const moneyFact = (label: string, value: number | null, currency: string) =>
  `<div><span>${esc(label)}</span><strong>${esc(money(value, currency))}</strong></div>`;
const adjustmentSum = (o: POrder) =>
  o.adjustments.reduce((sum, a) => sum + a.amount, 0);
const measureText = (v: unknown) => {
  if (!v || typeof v !== "object") return "";
  const x = v as Record<string, unknown>;
  return typeof x.raw === "string"
    ? x.raw
    : Object.entries(x)
        .map(([k, val]) => `${k}: ${String(val)}`)
        .join("；");
};

async function orderListPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "",
    sourceId = qs.get("sourceId") || "",
    page = Math.max(1, Number(qs.get("page") || 1));
  const [sources, result] = await Promise.all([
    request<PSource[]>("/procurement/sources"),
    request<{ rows: POrderRow[]; total: number; page: number; size: number }>(
      `/procurement/orders?q=${encodeURIComponent(q)}&sourceId=${encodeURIComponent(sourceId)}&page=${page}`,
    ),
  ]);
  const sourceOptions = {
    "": "全部来源",
    ...Object.fromEntries(sources.map((s) => [s.id, s.name])),
  };
  const rows = result.rows.map((o) => [
    `${esc(o.procurementSource.name)}<small>${esc(o.externalOrderNo)}</small>`,
    when(o.orderedAt),
    esc(o.sourceStatusRaw || "未记录"),
    `${money(o.totalAmount, o.currency)}<small>支付 ${money(o.paymentAmount, o.currency)}</small>`,
    `${o._count.lines}件<small>${o._count.shipments}个包裹 · ${o._count.returns}条退货/RMA</small>`,
    `<a class="btn subtle" href="#/procurement/${o.id}?returnTo=${encodeURIComponent(location.hash)}">核对订单</a>`,
  ]);
  const sourceRows = sources.map((source) => [
    `${esc(source.name)}<small>${esc(source.code)} · ${esc(sourceKinds[source.kind] || source.kind)}</small>`,
    `${esc(source.defaultCurrency)}<small>来源版本 v${source.version}</small>`,
    `${source.active ? "已启用" : "已停用"}<small>${source._count?.orders || 0} 笔订单</small>`,
    can("supply")
      ? button("调整默认币种", () => sourceMetadataDialog(source, reload))
      : "—",
  ]);
  const root = "procurement-" + crypto.randomUUID();
  onPageReady(root, (el, signal) => {
    el.querySelector<HTMLFormElement>("#procurement-search")?.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget as HTMLFormElement),
          next = new URLSearchParams();
        const q = String(d.get("q") || ""),
          s = String(d.get("sourceId") || "");
        if (q) next.set("q", q);
        if (s) next.set("sourceId", s);
        location.hash = "/procurement" + (next.toString() ? "?" + next : "");
      },
      { signal },
    );
  });
  return `<div id="${root}" class="procurement-page"><div class="page-title"><div><h1>采购历史</h1><p>保留订单、物流与退货来源记录；商品资料与库存请在商品库维护。</p></div><div class="button-row"><a class="btn" href="#/candidates">外部批量接收</a>${button("＋ 新增采购来源", () => sourceDialog(reload))}</div></div>
  <div class="notice">平台的 Shipped / Sold / Canceled / RMA 只作为来源记录，不会自动改变本地库存。</div>
  <form id="procurement-search" class="admin-filter-form"><label class="search-field"><span>搜索订单</span><input name="q" value="${esc(q)}" placeholder="订单号、原货号、品牌或商品名"></label>${select("sourceId", "采购来源", sourceOptions, sourceId)}<button class="btn primary">搜索</button><a class="btn" href="#/procurement">重置</a></form>
  ${table(["来源 / 订单", "下单日期", "平台状态", "来源金额", "件数 / 物流", "操作"], rows)}
  <div class="pagination"><span>共${result.total}笔 · 每页30笔</span>${page > 1 ? `<a class="btn" href="${procurementPageLink(page - 1)}">上一页</a>` : ""}${page * 30 < result.total ? `<a class="btn" href="${procurementPageLink(page + 1)}">下一页</a>` : ""}</div>
  <section class="panel procurement-sources"><h2>采购来源</h2><p>默认币种只用于后续未传币种的候选。调整时需要版本和依据，既有来源事实、TM、库存和成本不会被改写。</p>${table(["来源", "默认币种", "状态", "操作"], sourceRows)}</section></div>`;
}
function lineActions(line: PLine) {
  const parts: string[] = [
    button("核对实物", () => lineReviewDialog(line, reload), "primary"),
  ];
  if (line.itemLink)
    parts.push(
      `<a class="btn" href="#/items/${line.itemLink.item.id}?returnTo=${encodeURIComponent(location.hash)}">${esc(`查看 TM${String(line.itemLink.item.serial).padStart(6, "0")}`)}</a>`,
    );
  else if (line.sourceCandidate)
    parts.push(
      `<a class="btn" href="#/items/new?source=${line.sourceCandidate.id}">建立TM商品</a>`,
    );
  else if (line.businessDecision === "INCLUDE" && line.possession === "IN_HAND")
    parts.push(
      button("生成货源候选", async () => {
        await request(
          `/procurement/lines/${line.id}/source-candidate`,
          "POST",
          {},
        );
        toast("已生成货源候选");
        await reload();
      }),
    );
  if (!line.itemLink)
    parts.push(button("关联已有TM", () => linkItemDialog(line, reload)));
  return `<div class="button-row compact">${parts.join("")}</div>`;
}
function sourceFacts(line: PLine) {
  const prices = `<div class="procurement-price-grid">${moneyFact("订单行原价", line.lineAmount, line.currency)}${moneyFact("订单行折后金额", line.sourceLineNetAmount, line.currency)}${moneyFact("平台当前价", line.sourceCurrentPrice, line.currency)}${moneyFact("平台估计零售价", line.sourceEstimatedRetail, line.currency)}</div>`;
  const details = [
    fact("平台成色", line.sourceConditionRaw),
    fact("平台商品状态", line.sourceStatusRaw),
    fact("标签尺码", line.sizeLabelRaw),
    fact("颜色", line.colorRaw),
    fact("材质原文", line.materialRaw),
    fact(
      line.measurementsEstimated ? "平台估测尺寸" : "尺寸",
      measureText(line.measurements),
    ),
  ].join("");
  return (
    (line.ingestCandidates?.length
      ? `<div class="procurement-saved-photos">${line.ingestCandidates
          .flatMap((c) => c.assets)
          .map(
            (a) =>
              `<a href="/api/ingest/candidate-assets/${a.id}/original" target="_blank" rel="noopener"><img src="/api/ingest/candidate-assets/${a.id}/preview" alt="${esc(line.title)}" loading="lazy"></a>`,
          )
          .join(
            "",
          )}${line.ingestCandidates.map((c) => button("查看完整来源资料", () => showSourceEvidence(c.id))).join("")}</div>`
      : "") +
    prices +
    `<details class="procurement-source-detail"><summary>查看来源资料</summary><div class="procurement-facts">${details}</div>${line.descriptionRaw ? `<p>${esc(line.descriptionRaw)}</p>` : ""}${line.productUrl ? `<p><a href="${esc(line.productUrl)}" target="_blank" rel="noopener">打开原商品页面 ↗</a></p>` : ""}${line.imageUrls.length ? `<small>${line.imageUrls.length}个来源图片链接，仅作资料记录，未确认公开使用权。</small>` : ""}</details>`
  );
}
async function orderDetailPage(id: string) {
  const order = await request<POrder>(`/procurement/orders/${id}`);
  const lineName = new Map(
    order.lines.map((l) => [l.id, l.sourceSku || l.title]),
  );
  const adjustmentRows = order.adjustments.map((a) => [
    esc(adjustmentKinds[a.kind] || a.kind),
    esc(a.label),
    money(a.amount, a.currency),
  ]);
  const shipmentRows = order.shipments.map((s) => [
    esc(s.externalShipmentRef || s.shipmentKey),
    esc(s.carrier || "—"),
    esc(s.statusRaw || "—"),
    esc(
      s.lines
        .map((x) => lineName.get(x.lineId) || x.lineId.slice(0, 8))
        .join("、"),
    ),
  ]);
  const returnRows = order.returns.map((r) => [
    esc(r.externalReturnRef || r.returnKey),
    esc(r.statusRaw || "—"),
    esc(
      r.lines
        .map((x) => lineName.get(x.lineId) || x.lineId.slice(0, 8))
        .join("、"),
    ),
  ]);
  const lines = order.lines
    .map((line) => {
      const local = `<div class="procurement-local"><span class="status-pill ${line.businessDecision === "INCLUDE" ? "good" : line.businessDecision === "EXCLUDE" ? "muted" : "attention"}">${esc(decisions[line.businessDecision] || line.businessDecision)}</span><span class="status-pill">${esc(possessions[line.possession] || line.possession)}</span>${line.itemLink ? `<small>已关联 TM${String(line.itemLink.item.serial).padStart(6, "0")}</small>` : line.sourceCandidate ? "<small>已生成货源候选</small>" : ""}</div>`;
      return `<article class="procurement-line"><header><div><small>${esc(line.sourceSku || line.lineKey)}</small><h3>${esc(line.brandRaw ? line.brandRaw + " · " + line.title : line.title)}</h3></div>${local}</header>${sourceFacts(line)}${line.reviewNote ? `<p class="procurement-review-note">本地核对：${esc(line.reviewNote)}</p>` : ""}<footer>${lineActions(line)}</footer></article>`;
    })
    .join("");
  return `<div class="procurement-page"><p><a href="${esc(safeReturn(new URLSearchParams(location.hash.split("?")[1] || "").get("returnTo")) || "#/procurement")}">← 采购订单</a></p><div class="page-title"><div><h1>${esc(order.procurementSource.name)} · ${esc(order.externalOrderNo)}</h1><p>${order.orderedAt ? when(order.orderedAt) : "下单日期待补"} · 来源状态：${esc(order.sourceStatusRaw || "未记录")} ${order.returnabilityRaw ? `· ${esc(order.returnabilityRaw)}` : ""}</p></div></div>
  <div class="notice warning">以下状态和价格来自采购来源，只用于还原事实；不会自动改变本地库存、成色或人民币成本。</div>
  <section class="procurement-summary"><div><span>商品小计</span><strong>${money(order.subtotalAmount, order.currency)}</strong></div><div><span>订单调整合计</span><strong>${money(adjustmentSum(order), order.currency)}</strong></div><div><span>订单总额</span><strong>${money(order.totalAmount, order.currency)}</strong></div><div><span>支付金额</span><strong>${money(order.paymentAmount, order.currency)}</strong></div><div><span>来源版本</span><strong>v${order.version}</strong><small>保留${order.revisions.length}个近期快照</small></div></section>

  ${adjustmentRows.length ? `<details class="panel"><summary>查看折扣、运费、抵用额等金额调整</summary>${table(["类型", "名称", "金额"], adjustmentRows)}</details>` : ""}
  <div class="procurement-logistics">${shipmentRows.length ? `<section class="panel"><h2>物流包裹 · ${shipmentRows.length}</h2>${table(["包裹/物流号", "承运商", "来源状态", "包含订单行"], shipmentRows)}</section>` : ""}${returnRows.length ? `<section class="panel"><h2>退货 / RMA · ${returnRows.length}</h2>${table(["退货/RMA号", "来源状态", "关联订单行"], returnRows)}</section>` : ""}</div>
  <section class="procurement-lines"><div class="section-heading"><h2>逐件核对 · ${order.lines.length}件</h2><p>先确认“实物是否在手”和“是否纳入经营”，再确认入库。</p></div>${lines}</section></div>`;
}

export async function procurementPage(id?: string) {
  return id ? orderDetailPage(id) : orderListPage();
}

function procurementPageLink(page: number) {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  p.set("page", String(page));
  return "#/procurement?" + esc(p.toString());
}
