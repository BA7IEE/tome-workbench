import { z } from "zod";
import { amount, currency, expectedVersion, safeText, uuid } from "../common/domain";

const rawObject = z.record(z.unknown()).default({});
const optionalDate = z.string().datetime().nullable().optional().default(null);
const optionalAmount = amount.optional().default(null);
const signedAmount = z.number().int().min(-2000000000).max(2000000000);

export const procurementSourceInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{1,31}$/),
  name: safeText(150).min(1),
  kind: z.enum(["MARKETPLACE", "SUPPLIER", "OFFLINE", "OTHER"]).default("MARKETPLACE"),
  defaultCurrency: currency.default("CNY"),
  supplierId: uuid.nullable().optional().default(null),
  notes: safeText(2000).default(""),
}).strict();

export const procurementSourceMetadataUpdate = z.object({
  version: expectedVersion,
  defaultCurrency: currency,
  reason: safeText(2000).min(3),
}).strict();

const adjustment = z.object({
  adjustmentKey: safeText(120).min(1),
  kind: z.enum(["SHIPPING", "DISCOUNT", "STORE_CREDIT", "TAX", "FEE", "REFUND", "OTHER"]),
  label: safeText(300).min(1),
  amount: signedAmount,
  currency,
}).strict();
const purchaseLine = z.object({
  lineKey: safeText(120).min(1),
  sourceSku: safeText(120).default(""),
  title: safeText(300).min(1),
  brandRaw: safeText(150).default(""),
  categoryRaw: safeText(300).default(""),
  productUrl: safeText(2000).default(""),
  currency,
  lineAmount: optionalAmount,
  sourceLineNetAmount: optionalAmount,
  sourceCurrentPrice: optionalAmount,
  sourceEstimatedRetail: optionalAmount,
  sourceConditionRaw: safeText(150).default(""),
  sourceStatusRaw: safeText(150).default(""),
  sizeLabelRaw: safeText(150).default(""),
  colorRaw: safeText(150).default(""),
  materialRaw: safeText(1000).default(""),
  measurements: z.record(z.union([safeText(300), z.number().finite()])).default({}),
  measurementsEstimated: z.boolean().default(false),
  descriptionRaw: safeText(12000).default(""),
  imageUrls: z.array(safeText(2000).min(1)).max(50).default([]),
  rawPayload: rawObject,
}).strict();
const shipment = z.object({
  shipmentKey: safeText(120).min(1),
  externalShipmentRef: safeText(200).default(""),
  carrier: safeText(100).default(""),
  statusRaw: safeText(150).default(""),
  shippedAt: optionalDate,
  deliveredAt: optionalDate,
  lineKeys: z.array(safeText(120).min(1)).max(300).default([]),
  rawPayload: rawObject,
}).strict();

const purchaseReturn = z.object({
  returnKey: safeText(120).min(1),
  externalReturnRef: safeText(200).default(""),
  statusRaw: safeText(150).default(""),
  openedAt: optionalDate,
  lineKeys: z.array(safeText(120).min(1)).max(300).default([]),
  rawPayload: rawObject,
}).strict();

export const purchaseOrderImport = z.object({
  procurementSourceId: uuid,
  externalOrderNo: safeText(120).min(1),
  orderedAt: optionalDate,
  sourceStatusRaw: safeText(150).default(""),
  returnabilityRaw: safeText(200).default(""),
  currency,
  subtotalAmount: optionalAmount,
  totalAmount: optionalAmount,
  paymentAmount: optionalAmount,
  rawPayload: rawObject,
  adjustments: z.array(adjustment).max(100).default([]),
  lines: z.array(purchaseLine).min(1).max(500),
  shipments: z.array(shipment).max(100).default([]),
  returns: z.array(purchaseReturn).max(100).default([]),
}).strict();

export const purchaseLineReview = z.object({
  version: expectedVersion,
  businessDecision: z.enum(["UNDECIDED", "INCLUDE", "EXCLUDE"]),
  possession: z.enum(["UNKNOWN", "IN_HAND", "NOT_IN_HAND"]),
  reviewNote: safeText(2000).default(""),
}).strict();

export const purchaseLineLink = z.object({
  itemId: uuid,
  note: safeText(1000).default(""),
}).strict();
export const purchaseCostConfirm = z.object({
  amountCny: z.number().int().min(0).max(2000000000),
  basis: z.enum(["ACTUAL_CNY_OUTLAY", "CONFIRMED_BATCH_FX", "MANUAL_ALLOCATION", "OTHER"]),
  note: safeText(4000).min(3),
}).strict();

export const voidPurchaseCost = z.object({
  reason: safeText(4000).min(3),
}).strict();

export type PurchaseOrderImportInput = z.infer<typeof purchaseOrderImport>;
export type PurchaseLineInput = PurchaseOrderImportInput["lines"][number];
