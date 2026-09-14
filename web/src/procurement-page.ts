import { costBatchPage } from "./cost-batch";
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
  cents,
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
  costConfirmations: {
    id: string;
    amountCny: number;
    basis: string;
    note: string;
    confirmedAt: string;
  }[];
};
export type POrder = POrderRow & {
  costBasis?: {
    version: number;
    mode: string;
    cashPaidCny: number | null;
    fxMicros: number | null;
    foreignEconomicTotalOverride: number | null;
    overheadCny: number;
    note: string;
  } | null;
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

type PaymentBreakdown = {
  cashPaid: number;
  creditUsed: number;
  cashRefunded: number;
  creditRefunded: number;
  lineRefunds?: { lineId: string; amount: number }[];
};
export type CostPreview = {
  paymentBreakdown: PaymentBreakdown | null;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  foreignEconomicTotal: number | null;
  effectiveFxMicros: number | null;
  economicCny: number | null;
  overheadCny: number | null;
  totalCny: number | null;
  basis: {
    version: number;
    mode: string;
    cashPaidCny: number | null;
    fxMicros: number | null;
    foreignEconomicTotalOverride: number | null;
    overheadCny: number;
    note: string;
  } | null;
  rows: {
    lineId: string;
    itemId: string;
    code: string;
    title: string;
    lineAmount: number;
    purchaseCny: number;
    overheadCny: number;
    totalCny: number;
  }[];
};
const decisions: Record<string, string> = {
  UNDECIDED: "待核对",
  INCLUDE: "纳入经营",
  EXCLUDE: "排除",
};
const possessions: Record<string, string> = {
  UNKNOWN: "未知",
  IN_HAND: "实物在手",
  NOT_IN_HAND: "不在手",
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
const parseAmount = (value: string) => {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error(`金额“${v}”格式不正确`);
  return Math.round(Number(v) * 100);
};
const splitLines = (raw: string) => {
  const normalized = raw.replace(/(?:\r?\n)+$/, "");
  return normalized ? normalized.split(/\r?\n/) : [];
};
const cells = (line: string) => line.split("\t").map((x) => x.trim());
function parseOptionalTab(raw: string, required: string[]) {
  const rows = splitLines(raw);
  return rows.length <= 1 ? [] : parseTab(raw, required);
}
const parseSignedAmount = (value: string) => {
  const v = value.trim();
  if (!v) return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) throw new Error(`金额“${v}”格式不正确`);
  return Math.round(Number(v) * 100);
};
const toIso = (value: string) =>
  value.trim() ? new Date(value.trim() + "T00:00:00Z").toISOString() : null;
const boolCell = (value: string) =>
  ["1", "是", "true", "TRUE", "yes", "YES"].includes(value.trim());
const linksCell = (value: string) =>
  value
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const lineKeysCell = (value: string) =>
  value
    .split(/[,，;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
function parseTab(raw: string, required: string[]) {
  const rows = splitLines(raw).map(cells);
  if (rows.length < 2) throw new Error("请保留标题行，并至少提供一行数据");
  const head = rows[0];
  for (const name of required)
    if (!head.includes(name)) throw new Error(`缺少列：${name}`);
  if (new Set(head).size !== head.length) throw new Error("表格列名不能重复");
  return rows
    .slice(1)
    .filter((r) => r.some(Boolean))
    .map((r, n) => {
      if (r.length !== head.length)
        throw new Error(`第${n + 2}行列数和标题行不一致`);
      return Object.fromEntries(head.map((h, i) => [h, r[i] || ""]));
    });
}
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

function sourceCostPolicyDialog(source: PSource, after: () => Promise<void>) {
  form(
    "来源成本规则",
    note(
      "这是一条来源级规则，只需配置一次。TRR建议：每单附加成本¥200、按商品原价比例分摊、Store Credit计入采购支付价值。",
    ) +
      field(
        "overhead",
        "每单附加成本（人民币）",
        (source.orderOverheadCny / 100).toFixed(2),
        "text",
        true,
        'inputmode="decimal"',
      ) +
      select(
        "storeCredit",
        "Store Credit是否计入支付价值",
        { true: "是，视为支付价值", false: "否，视为折扣" },
        String(source.storeCreditAsPayment),
      ) +
      note("当前分摊方法：按商品订单原价比例分摊。"),
    async (d, k) => {
      const overhead = cents(d.get("overhead"));
      if (overhead === null) throw new Error("请填写每单附加成本");
      return request(
        `/costing/sources/${source.id}/policy`,
        "POST",
        {
          version: source.version,
          orderOverheadCny: overhead,
          costAllocationMethod: "PROPORTIONAL_LINE_AMOUNT",
          storeCreditAsPayment: text(d, "storeCredit") === "true",
          note: "经营人员确认来源成本规则",
        },
        k,
      );
    },
    "保存规则",
    after,
  );
}
function parseFx(value: string) {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(v) || Number(v) <= 0)
    throw new Error("汇率格式不正确，例如7.20");
  return Math.round(Number(v) * 1000000);
}
export function orderCostBasisDialog(
  order: POrder,
  after: () => Promise<void>,
  payment: PaymentBreakdown | null = null,
) {
  const basis = order.costBasis,
    source = order.procurementSource;
  form(
    "确认订单成本依据",
    note(
      "Credit与现金同等计入支付。人民币扣款须对应退款前的原始现金支付；没有扣款依据时填写确认汇率。确认后的汇率会固定保存。",
    ) +
      select(
        "mode",
        "换算方式",
        {
          ACTUAL_CASH_CNY: "实际人民币扣款（优先）",
          CONFIRMED_FX: "人工确认汇率",
          SUGGESTED_FX: "系统建议汇率（需人工确认）",
        },
        basis?.mode || "ACTUAL_CASH_CNY",
      ) +
      field(
        "cashPaidCny",
        "实际人民币扣款",
        basis?.cashPaidCny == null ? "" : (basis.cashPaidCny / 100).toFixed(2),
        "text",
        false,
        'inputmode="decimal" placeholder="例如5054.40"',
      ) +
      field(
        "fx",
        "确认汇率",
        basis?.fxMicros == null ? "" : String(basis.fxMicros / 1000000),
        "text",
        false,
        'inputmode="decimal" placeholder="例如7.20"',
      ) +
      `<details${payment ? " open" : ""}><summary>核对现金与Credit支付、退款</summary>${note("以下四项均使用订单币种。现金支付和Credit使用填写退款前金额，未发生的项目填0。填全后系统计算净额，不再重复扣退款；无需退货的退款也要记录。")}${[
        ["cashPaid", "原始现金支付"],
        ["creditUsed", "使用的Store Credit"],
        ["cashRefunded", "退回现金"],
        ["creditRefunded", "退回Store Credit"],
      ]
        .map(([key, label]) =>
          field(
            key,
            `${label}（${order.currency}）`,
            payment
              ? (
                  payment[
                    key as
                      | "cashPaid"
                      | "creditUsed"
                      | "cashRefunded"
                      | "creditRefunded"
                  ] / 100
                ).toFixed(2)
              : "",
            "text",
            false,
            'inputmode="decimal"',
          ),
        )
        .join(
          "",
        )}<details${payment?.lineRefunds?.length ? " open" : ""}><summary>退款明确属于某件商品</summary>${note("已明确归属的退款填写在对应商品下，其他留空。逐件退款合计须等于上方全部退款；未指定归属时按整单净额比例分摊。")}${order.lines
        .map((line) => {
          const amount = payment?.lineRefunds?.find(
            (r) => r.lineId === line.id,
          )?.amount;
          return field(
            `lineRefund_${line.id}`,
            `${line.title} · 退款（${order.currency}）`,
            amount === undefined ? "" : (amount / 100).toFixed(2),
            "text",
            false,
            'inputmode="decimal"',
          );
        })
        .join("")}</details></details>` +
      field(
        "override",
        "RMA/排除后的最终经济支付（订单币种）",
        basis?.foreignEconomicTotalOverride == null
          ? ""
          : (basis.foreignEconomicTotalOverride / 100).toFixed(2),
        "text",
        false,
        'inputmode="decimal"',
      ) +
      note(
        "填写上方支付退款明细时，由明细计算最终经济支付；否则可直接填写已核对的净额，必须包含Credit价值。全额退回可以填0。退回实物的去向仍须单独核对，成本计算不会自动改变库存。",
      ) +
      field(
        "overhead",
        "本单附加成本（人民币）",
        ((basis?.overheadCny ?? source.orderOverheadCny) / 100).toFixed(2),
        "text",
        true,
        'inputmode="decimal"',
      ) +
      area("note", "确认依据", basis?.note || "", 3),
    async (d, k) => {
      const cash = cents(d.get("cashPaidCny")),
        override = cents(d.get("override")),
        overhead = cents(d.get("overhead"));
      if (overhead === null) throw new Error("请填写本单附加成本");
      const paymentFields = {
        cashPaid: cents(d.get("cashPaid")),
        creditUsed: cents(d.get("creditUsed")),
        cashRefunded: cents(d.get("cashRefunded")),
        creditRefunded: cents(d.get("creditRefunded")),
      };
      const lineRefunds = order.lines.flatMap((line) => {
        const amount = cents(d.get(`lineRefund_${line.id}`));
        return amount !== null && amount > 0
          ? [{ lineId: line.id, amount }]
          : [];
      });
      const hasPayment =
        lineRefunds.length > 0 ||
        Object.values(paymentFields).some((v) => v !== null);
      if (hasPayment && Object.values(paymentFields).some((v) => v === null))
        throw new Error("请填全现金、Credit及两项退款金额；未发生的项目填0");
      return request(
        `/costing/orders/${order.id}/basis`,
        "POST",
        {
          version: basis?.version ?? 0,
          mode: text(d, "mode"),
          cashPaidCny: cash,
          fxMicros: parseFx(text(d, "fx")),
          foreignEconomicTotalOverride: hasPayment ? null : override,
          paymentBreakdown: hasPayment
            ? { ...paymentFields, lineRefunds }
            : null,
          overheadCny: overhead,
          note: text(d, "note"),
          confirmed: true,
        },
        k,
      );
    },
    "保存成本依据",
    after,
  );
}
const lineTemplate =
  "行键\t原货号\t品牌\t商品名称\t品类\t订单行金额\t平台现价\t估计零售价\t平台成色\t平台状态\t标签尺码\t颜色\t材质\t尺寸\t尺寸为估测\t商品链接\t商品描述\t图片链接\n";
const adjustmentTemplate = "调整键\t类型\t名称\t金额\n";
const shipmentTemplate = "包裹键\t物流单号\t承运商\t状态\t订单行键\n";
const returnTemplate = "退货键\t退货号\t状态\t订单行键\n";
function buildOrderImportBody(d: FormData) {
  const currency = text(d, "currency"),
    rows = parseTab(text(d, "lines"), ["商品名称"]);
  const lines = rows.map((r, n) => {
    const lineKey = (r.行键 || r.原货号 || "").trim();
    if (!lineKey) throw new Error(`订单行第${n + 2}行缺少“行键”或“原货号”`);
    return {
      lineKey,
      sourceSku: r.原货号 || "",
      title: r.商品名称,
      brandRaw: r.品牌 || "",
      categoryRaw: r.品类 || "",
      productUrl: r.商品链接 || "",
      currency,
      lineAmount: parseAmount(r.订单行金额 || ""),
      sourceCurrentPrice: parseAmount(r.平台现价 || ""),
      sourceEstimatedRetail: parseAmount(r.估计零售价 || ""),
      sourceConditionRaw: r.平台成色 || "",
      sourceStatusRaw: r.平台状态 || "",
      sizeLabelRaw: r.标签尺码 || "",
      colorRaw: r.颜色 || "",
      materialRaw: r.材质 || "",
      measurements: (r.尺寸 || "").trim() ? { raw: r.尺寸.trim() } : {},
      measurementsEstimated: boolCell(r.尺寸为估测 || ""),
      descriptionRaw: r.商品描述 || "",
      imageUrls: linksCell(r.图片链接 || ""),
      rawPayload: r,
    };
  });
  const kindMap: Record<string, string> = {
    运费: "SHIPPING",
    折扣: "DISCOUNT",
    抵用余额: "STORE_CREDIT",
    税费: "TAX",
    费用: "FEE",
    退款: "REFUND",
    其他: "OTHER",
  };
  const adjustments = parseOptionalTab(text(d, "adjustments"), ["调整键"])
    .filter((r) => r.调整键)
    .map((r) => ({
      adjustmentKey: r.调整键,
      kind: kindMap[r.类型] || r.类型 || "OTHER",
      label: r.名称 || r.类型 || "其他调整",
      amount: parseSignedAmount(r.金额 || ""),
      currency,
    }));
  const shipments = parseOptionalTab(text(d, "shipments"), ["包裹键"])
    .filter((r) => r.包裹键)
    .map((r) => ({
      shipmentKey: r.包裹键,
      externalShipmentRef: r.物流单号 || "",
      carrier: r.承运商 || "",
      statusRaw: r.状态 || "",
      lineKeys: lineKeysCell(r.订单行键 || ""),
      rawPayload: r,
    }));
  const returns = parseOptionalTab(text(d, "returns"), ["退货键"])
    .filter((r) => r.退货键)
    .map((r) => ({
      returnKey: r.退货键,
      externalReturnRef: r.退货号 || "",
      statusRaw: r.状态 || "",
      lineKeys: lineKeysCell(r.订单行键 || ""),
      rawPayload: r,
    }));
  if (new Set(lines.map((x) => x.lineKey)).size !== lines.length)
    throw new Error("订单行键重复，请先修正");
  return {
    procurementSourceId: text(d, "procurementSourceId"),
    externalOrderNo: text(d, "externalOrderNo"),
    orderedAt: toIso(text(d, "orderedAt")),
    sourceStatusRaw: text(d, "sourceStatusRaw"),
    returnabilityRaw: text(d, "returnabilityRaw"),
    currency,
    subtotalAmount: parseAmount(text(d, "subtotalAmount")),
    totalAmount: parseAmount(text(d, "totalAmount")),
    paymentAmount: parseAmount(text(d, "paymentAmount")),
    rawPayload: {
      entryMode: "MANUAL_TABLE",
      rawTables: {
        lines: text(d, "lines"),
        adjustments: text(d, "adjustments"),
        shipments: text(d, "shipments"),
        returns: text(d, "returns"),
      },
    },
    adjustments,
    lines,
    shipments,
    returns,
  };
}
function orderPreviewDialog(
  body: ReturnType<typeof buildOrderImportBody>,
  sources: PSource[],
) {
  const source = sources.find((s) => s.id === body.procurementSourceId),
    lineSum = body.lines.reduce((n, x) => n + (x.lineAmount || 0), 0),
    adjustmentTotal = body.adjustments.reduce((n, x) => n + x.amount, 0),
    base = body.subtotalAmount ?? lineSum,
    calculated = base + adjustmentTotal;
  const imbalance =
    body.totalAmount !== null && calculated !== body.totalAmount
      ? `<div class="notice warning">金额尚未核平：商品基础金额 + 调整 = ${money(calculated, body.currency)}，但订单总额是 ${money(body.totalAmount, body.currency)}。可以保留来源事实，但建议核对后再确认人民币成本。</div>`
      : "";
  const rows = body.lines.map((x) => [
    esc(x.sourceSku || x.lineKey),
    esc((x.brandRaw ? x.brandRaw + " · " : "") + x.title),
    money(x.lineAmount, body.currency),
    money(x.sourceCurrentPrice, body.currency),
    esc(x.sourceConditionRaw || "—"),
  ]);
  let createdId = "";
  form(
    "核对采购订单",
    note(
      `${source?.name || "采购来源"} · ${body.externalOrderNo} · ${body.lines.length}件 · ${body.shipments.length}个包裹 · ${body.returns.length}条退货/RMA`,
    ) +
      imbalance +
      `<div class="procurement-preview-totals"><span>订单行合计 <strong>${money(lineSum, body.currency)}</strong></span><span>调整合计 <strong>${money(adjustmentTotal, body.currency)}</strong></span><span>订单总额 <strong>${money(body.totalAmount, body.currency)}</strong></span><span>支付 <strong>${money(body.paymentAmount, body.currency)}</strong></span></div>` +
      table(
        ["原货号", "品牌 / 商品", "订单行金额", "平台现价", "平台成色"],
        rows,
      ) +
      note(
        "确认导入后仍只是采购来源记录，不会自动生成TM商品，也不会自动换算人民币成本。",
      ),
    async (_d, k) => {
      const out = await request<{ id: string }>(
        "/procurement/orders/import",
        "POST",
        body,
        k,
      );
      createdId = out.id;
      return out;
    },
    "确认导入",
    async () => {
      if (createdId) location.hash = "/procurement/" + createdId;
    },
  );
}
function orderImportDialog(sources: PSource[]) {
  if (!sources.length) {
    toast("请先新增采购来源", true);
    return;
  }
  const sourceOptions = Object.fromEntries(
    sources.filter((s) => s.active).map((s) => [s.id, `${s.name} · ${s.code}`]),
  );
  const html =
    note(
      "先粘贴来源事实，下一步会预览核对；不会自动生成库存、换算人民币成本或把平台状态映射成本地状态。",
    ) +
    select("procurementSourceId", "采购来源", sourceOptions) +
    field("externalOrderNo", "订单号", "", "text", true) +
    field("orderedAt", "下单日期", "", "date") +
    field("sourceStatusRaw", "平台订单状态") +
    field("returnabilityRaw", "平台退货限制 / 标记") +
    select("currency", "订单币种", currencies, "USD") +
    field(
      "subtotalAmount",
      "商品小计",
      "",
      "text",
      false,
      'inputmode="decimal"',
    ) +
    field("totalAmount", "订单总额", "", "text", false, 'inputmode="decimal"') +
    field(
      "paymentAmount",
      "实际支付金额",
      "",
      "text",
      false,
      'inputmode="decimal"',
    ) +
    area("lines", "订单行 · 从Excel粘贴", lineTemplate, 10) +
    area("adjustments", "折扣 / 运费 / 抵用额", adjustmentTemplate, 5) +
    area("shipments", "物流包裹（可留空）", shipmentTemplate, 5) +
    area("returns", "退货 / RMA（可留空）", returnTemplate, 5);
  form(
    "导入采购订单",
    html,
    async (d) => {
      const body = buildOrderImportBody(d);
      setTimeout(() => orderPreviewDialog(body, sources), 0);
      return { nextStep: true };
    },
    "生成预览",
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

function costPanel(order: POrder, preview: CostPreview) {
  const rows = preview.rows.map((r) => [
    esc(r.code),
    esc(r.title),
    money(r.lineAmount, order.currency),
    money(r.purchaseCny, "CNY"),
    money(r.overheadCny, "CNY"),
    `<strong>${esc(money(r.totalCny, "CNY"))}</strong>`,
  ]);
  const blockers = preview.blockers.length
    ? `<div class="notice warning"><strong>暂不能自动写入成本</strong>${preview.blockers.map((x) => `<p>${esc(x)}</p>`).join("")}</div>`
    : "";
  const warnings = preview.warnings.length
    ? `<div class="cost-warnings">${preview.warnings.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`
    : "";
  const actions =
    button("来源成本规则", () =>
      sourceCostPolicyDialog(order.procurementSource, reload),
    ) +
    button(
      order.costBasis ? "修改订单成本依据" : "确认订单成本依据",
      () => orderCostBasisDialog(order, reload, preview.paymentBreakdown),
      order.costBasis ? "" : "primary",
    ) +
    (preview.ready && preview.basis
      ? button(
          `确认写入 ${preview.rows.length} 件TM成本`,
          async () => {
            await request(`/costing/orders/${order.id}/commit`, "POST", {
              basisVersion: preview.basis!.version,
              confirmed: true,
            });
            toast("人民币成本已写入TM商品");
            await reload();
          },
          "primary",
        )
      : "");
  return `<section class="panel procurement-cost-panel"><div class="panel-head"><div><h2>人民币取得成本</h2><p>订单只负责计算依据；最终成本写入每件TM商品。</p></div><div class="button-row">${actions}</div></div>
    <div class="cost-policy-summary"><span>来源规则：每单附加成本 <strong>${money(order.procurementSource.orderOverheadCny, "CNY")}</strong></span><span>Store Credit：<strong>${order.procurementSource.storeCreditAsPayment ? "计入支付价值" : "视为折扣"}</strong></span><span>订单依据：<strong>${order.costBasis ? `v${order.costBasis.version}` : "待确认"}</strong></span>${preview.totalCny !== null ? `<span>本单最终成本：<strong>${money(preview.totalCny, "CNY")}</strong></span>` : ""}</div>
    ${blockers}${warnings}${rows.length ? table(["TM", "商品", "订单原价", "采购分摊", "附加分摊", "最终成本"], rows) : ""}
  </section>`;
}
async function orderListPage() {
  if (
    new URLSearchParams(location.hash.split("?")[1] || "").get("mode") ===
    "costs"
  )
    return costBatchPage();
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
  return `<div id="${root}" class="procurement-page"><div class="page-title"><div><h1>采购历史</h1><p>订单、物流和RMA用于追溯来源与计算成本；日常经营以TM商品为中心。</p></div><div class="button-row">${can("finance") ? '<a class="btn primary" href="#/procurement?mode=costs">集中确认成本</a>' : ""}<a class="btn" href="#/candidates">外部批量接收</a>${button("＋ 导入采购订单", () => orderImportDialog(sources), "")}${button("＋ 新增采购来源", () => sourceDialog(reload))}</div></div>
  <div class="notice">平台的 Shipped / Sold / Canceled / RMA 只作为来源记录，不会自动改变本地库存。</div>
  <form id="procurement-search" class="admin-filter-form"><label class="search-field"><span>搜索订单</span><input name="q" value="${esc(q)}" placeholder="订单号、原货号、品牌或商品名"></label>${select("sourceId", "采购来源", sourceOptions, sourceId)}<button class="btn primary">搜索</button><a class="btn" href="#/procurement">重置</a></form>
  ${table(["来源 / 订单", "下单日期", "平台状态", "来源金额", "件数 / 物流", "操作"], rows)}
  <div class="pagination"><span>共${result.total}笔 · 每页30笔</span>${page > 1 ? `<a class="btn" href="${procurementPageLink(page - 1)}">上一页</a>` : ""}${page * 30 < result.total ? `<a class="btn" href="${procurementPageLink(page + 1)}">下一页</a>` : ""}</div></div>`;
}
function lineActions(line: PLine) {
  const parts: string[] = [
    button("核对实物", () => lineReviewDialog(line, reload), "primary"),
  ];
  if (line.itemLink)
    parts.push(
      `<a class="btn" href="#/items/${line.itemLink.item.id}/edit?returnTo=${encodeURIComponent(location.hash)}">${esc(`查看 TM${String(line.itemLink.item.serial).padStart(6, "0")}`)}</a>`,
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
  const prices = `<div class="procurement-price-grid">${moneyFact("订单行金额", line.lineAmount, line.currency)}${moneyFact("平台当前价", line.sourceCurrentPrice, line.currency)}${moneyFact("平台估计零售价", line.sourceEstimatedRetail, line.currency)}</div>`;
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
  const [order, costPreview] = await Promise.all([
    request<POrder>(`/procurement/orders/${id}`),
    can("finance")
      ? request<CostPreview>(`/costing/orders/${id}/preview`)
      : Promise.resolve(null),
  ]);
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
  ${costPreview ? costPanel(order, costPreview) : ""}
  ${adjustmentRows.length ? `<details class="panel"><summary>查看折扣、运费、抵用额等金额调整</summary>${table(["类型", "名称", "金额"], adjustmentRows)}</details>` : ""}
  <div class="procurement-logistics">${shipmentRows.length ? `<section class="panel"><h2>物流包裹 · ${shipmentRows.length}</h2>${table(["包裹/物流号", "承运商", "来源状态", "包含订单行"], shipmentRows)}</section>` : ""}${returnRows.length ? `<section class="panel"><h2>退货 / RMA · ${returnRows.length}</h2>${table(["退货/RMA号", "来源状态", "关联订单行"], returnRows)}</section>` : ""}</div>
  <section class="procurement-lines"><div class="section-heading"><h2>逐件核对 · ${order.lines.length}件</h2><p>先确认“实物是否在手”和“是否纳入经营”，再建立TM或确认人民币成本。</p></div>${lines}</section></div>`;
}

export async function procurementPage(id?: string) {
  return id ? orderDetailPage(id) : orderListPage();
}

function procurementPageLink(page: number) {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  p.set("page", String(page));
  return "#/procurement?" + esc(p.toString());
}
