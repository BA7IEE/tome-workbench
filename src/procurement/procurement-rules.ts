import {z} from 'zod';
import {amount,currency,safeText,uuid} from '../common/domain';

export const procurementKinds=['MARKETPLACE','SUPPLIER','OFFLINE','OTHER'] as const;
export const procurementSourceInput=z.object({
  code:z.string().trim().regex(/^[A-Z][A-Z0-9_.:-]{1,63}$/),
  name:safeText(150).min(1),kind:z.enum(procurementKinds).default('MARKETPLACE'),
  defaultCurrency:currency.default('CNY'),supplierId:uuid.optional(),notes:safeText(4000).default('')
}).strict();
const signedAmount=z.number().int().min(-2000000000).max(2000000000);
const rawJson=z.record(z.unknown()).default({});
const maybeDate=z.string().datetime().nullable().optional();
export const purchaseLineInput=z.object({
  lineKey:safeText(200).min(1),sourceSku:safeText(200).default(''),title:safeText(500).min(1),
  brandRaw:safeText(200).default(''),categoryRaw:safeText(300).default(''),productUrl:z.string().url().or(z.literal('')).default(''),
  currency:currency,lineAmount:amount.optional().default(null),sourceCurrentPrice:amount.optional().default(null),sourceEstimatedRetail:amount.optional().default(null),
  sourceConditionRaw:safeText(200).default(''),sourceStatusRaw:safeText(200).default(''),sizeLabelRaw:safeText(100).default(''),colorRaw:safeText(100).default(''),materialRaw:safeText(2000).default(''),
  measurements:z.record(z.unknown()).default({}),measurementsEstimated:z.boolean().default(false),descriptionRaw:safeText(12000).default(''),
  imageUrls:z.array(z.string().url()).max(50).default([]),rawPayload:rawJson
}).strict();
export const adjustmentInput=z.object({
  adjustmentKey:z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,150}$/),kind:z.enum(['DISCOUNT','SHIPPING','STORE_CREDIT','TAX','PAYMENT','OTHER']),
  label:safeText(300).min(1),amount:signedAmount,currency
}).strict();
export const shipmentInput=z.object({
  shipmentKey:z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,150}$/),externalShipmentRef:safeText(300).default(''),carrier:safeText(150).default(''),statusRaw:safeText(200).default(''),
  shippedAt:maybeDate,deliveredAt:maybeDate,lineKeys:z.array(safeText(200).min(1)).max(300).default([]),rawPayload:rawJson
}).strict();
export const returnInput=z.object({
  returnKey:z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,150}$/),externalReturnRef:safeText(300).default(''),statusRaw:safeText(200).default(''),openedAt:maybeDate,
  lineKeys:z.array(safeText(200).min(1)).max(300).default([]),rawPayload:rawJson
}).strict();
export const purchaseOrderImport=z.object({
  procurementSourceId:uuid,externalOrderNo:safeText(200).min(1),orderedAt:maybeDate,sourceStatusRaw:safeText(200).default(''),returnabilityRaw:safeText(300).default(''),
  currency:currency,subtotalAmount:amount.optional().default(null),totalAmount:amount.optional().default(null),paymentAmount:amount.optional().default(null),rawPayload:rawJson,
  lines:z.array(purchaseLineInput).min(1).max(300),adjustments:z.array(adjustmentInput).max(100).default([]),shipments:z.array(shipmentInput).max(100).default([]),returns:z.array(returnInput).max(100).default([])
}).strict().superRefine((v,ctx)=>{
  const unique=(xs:string[],path:string)=>{const seen=new Set<string>();for(const x of xs){if(seen.has(x))ctx.addIssue({code:'custom',message:`${path}中存在重复键：${x}`});seen.add(x);}};
  unique(v.lines.map(x=>x.lineKey),'订单行');unique(v.adjustments.map(x=>x.adjustmentKey),'金额项');unique(v.shipments.map(x=>x.shipmentKey),'物流包裹');unique(v.returns.map(x=>x.returnKey),'退货记录');
  const keys=new Set(v.lines.map(x=>x.lineKey));for(const group of [...v.shipments,...v.returns])for(const key of group.lineKeys)if(!keys.has(key))ctx.addIssue({code:'custom',message:`关联了不存在的订单行：${key}`});
});
export type PurchaseOrderInput=z.infer<typeof purchaseOrderImport>;
export const purchaseLineReview=z.object({version:z.number().int().positive(),businessDecision:z.enum(['UNDECIDED','INCLUDE','EXCLUDE']),possession:z.enum(['UNKNOWN','IN_HAND','NOT_IN_HAND']),note:safeText(4000).default('')}).strict();
export const purchaseCostInput=z.object({version:z.number().int().positive(),amountCny:z.number().int().min(0).max(2000000000),basis:z.enum(['ACTUAL_RMB','MANUAL_CONFIRMED','OTHER']),note:safeText(4000).min(1),confirmed:z.literal(true)}).strict();
export const itemLinkInput=z.object({itemId:uuid,note:safeText(2000).min(1)}).strict();
