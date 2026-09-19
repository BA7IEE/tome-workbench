import type { Prisma, PurchaseLine } from "@prisma/client";
import type {
  PurchaseOrderImportInput,
  PurchaseLineInput,
} from "./procurement.schemas";

export const asDate = (value: string | null) =>
  value ? new Date(value) : null;

export function normalizedOrderSnapshot(input: PurchaseOrderImportInput) {
  return {
    ...input,
    adjustments: [...input.adjustments].sort((a, b) =>
      a.adjustmentKey.localeCompare(b.adjustmentKey),
    ),
    lines: [...input.lines].sort((a, b) => a.lineKey.localeCompare(b.lineKey)),
    shipments: [...input.shipments]
      .map((s) => ({ ...s, lineKeys: [...s.lineKeys].sort() }))
      .sort((a, b) => a.shipmentKey.localeCompare(b.shipmentKey)),
    returns: [...input.returns]
      .map((r) => ({ ...r, lineKeys: [...r.lineKeys].sort() }))
      .sort((a, b) => a.returnKey.localeCompare(b.returnKey)),
  };
}

export function lineData(line: PurchaseLineInput) {
  return {
    lineKey: line.lineKey,
    sourceSku: line.sourceSku,
    title: line.title,
    brandRaw: line.brandRaw,
    categoryRaw: line.categoryRaw,
    productUrl: line.productUrl,
    currency: line.currency,
    lineAmount: line.lineAmount,
    sourceLineNetAmount: line.sourceLineNetAmount,
    sourceCurrentPrice: line.sourceCurrentPrice,
    sourceEstimatedRetail: line.sourceEstimatedRetail,
    sourceConditionRaw: line.sourceConditionRaw,
    sourceStatusRaw: line.sourceStatusRaw,
    sizeLabelRaw: line.sizeLabelRaw,
    colorRaw: line.colorRaw,
    materialRaw: line.materialRaw,
    measurements: line.measurements as Prisma.InputJsonValue,
    measurementsEstimated: line.measurementsEstimated,
    descriptionRaw: line.descriptionRaw,
    imageUrls: line.imageUrls,
    rawPayload: line.rawPayload as Prisma.InputJsonValue,
  };
}

export function measurementsText(
  line: Pick<PurchaseLine, "measurements" | "measurementsEstimated">,
) {
  if (
    !line.measurements ||
    typeof line.measurements !== "object" ||
    Array.isArray(line.measurements)
  )
    return "";
  return Object.entries(line.measurements as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

export function localCategoryFromSource(raw: string) {
  const value = raw.normalize("NFKC").trim();
  if (/(?:^|[\/>])\s*clothing\s*(?:[\/>]|$)/i.test(value)) return "CLOTHING";
  if (/(?:^|[\/>])\s*(?:bags?|handbags?)\s*(?:[\/>]|$)/i.test(value))
    return "BAG";
  if (/(?:^|[\/>])\s*(?:shoes?|footwear)\s*(?:[\/>]|$)/i.test(value))
    return "SHOES";
  if (/(?:^|[\/>])\s*accessories\s*(?:[\/>]|$)/i.test(value))
    return "ACCESSORY";
  return "OTHER";
}

export function sourceCandidatePayload(
  sourceName: string,
  orderNo: string,
  line: PurchaseLine,
) {
  return {
    supplierCode: line.sourceSku,
    brand: line.brandRaw,
    category: localCategoryFromSource(line.categoryRaw),
    sourceCategoryRaw: line.categoryRaw,
    sizeLabel: line.sizeLabelRaw,
    material: line.materialRaw,
    measurements: measurementsText(line),
    measurementSource: line.measurementsEstimated
      ? `${sourceName} · 平台估测尺寸`
      : `${sourceName} · 来源资料`,
    sourceConditionRaw: line.sourceConditionRaw,
    sourceStatusRaw: line.sourceStatusRaw,
    sourceUrl: line.productUrl,
    sourceDescription: line.descriptionRaw,
    sourceCurrentPrice: line.sourceCurrentPrice,
    sourceEstimatedRetail: line.sourceEstimatedRetail,
    sourceLineAmount: line.lineAmount,
    sourceLineNetAmount: line.sourceLineNetAmount,
    sourceCurrency: line.currency,
    purchaseOrderNo: orderNo,
    purchaseLineId: line.id,
    ownership: "OWN",
  };
}

export function defaultCostAllocationMethod(code: string) {
  const normalized = code.trim().toUpperCase();
  return normalized === "TRR" || /^TRR[_-]/.test(normalized)
    ? "PROPORTIONAL_LINE_NET_AMOUNT"
    : "PROPORTIONAL_LINE_AMOUNT";
}

export function procurementSourceKey(
  code: string,
  orderNo: string,
  line: PurchaseLine,
) {
  const ref = (line.sourceSku || line.lineKey)
    .slice(0, 60)
    .replace(/\s+/g, "_");
  return `PROC:${code}:${orderNo.slice(0, 60)}:${ref}:${line.id.slice(0, 8)}`;
}
