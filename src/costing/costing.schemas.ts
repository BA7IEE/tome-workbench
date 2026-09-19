import { z } from "zod";
import { safeText, uuid } from "../common/domain";
const money = z.number().int().min(0).max(2000000000);

export const paymentBreakdownInput = z
  .object({
    cashPaid: money,
    creditUsed: money,
    cashRefunded: money,
    creditRefunded: money,
    lineRefunds: z
      .array(z.object({ lineId: uuid, amount: money.min(1) }).strict())
      .max(500)
      .optional(),
  })
  .strict();

export const sourceCostPolicyInput = z
  .object({
    version: z.number().int().positive(),
    orderOverheadCny: money,
    costAllocationMethod: z.enum([
      "PROPORTIONAL_LINE_AMOUNT",
      "PROPORTIONAL_LINE_NET_AMOUNT",
    ]),
    storeCreditAsPayment: z.boolean(),
    note: safeText(1000).default(""),
  })
  .strict();

export const orderCostBasisInput = z
  .object({
    version: z.number().int().min(0),
    mode: z.enum(["ACTUAL_CASH_CNY", "CONFIRMED_FX", "SUGGESTED_FX"]),
    cashPaidCny: money.nullable().default(null),
    fxMicros: z.number().int().min(1).max(100000000).nullable().default(null),
    foreignEconomicTotalOverride: money.nullable().default(null),
    paymentBreakdown: paymentBreakdownInput.nullable().optional().default(null),
    overheadCny: money,
    note: safeText(3000).min(3),
    confirmed: z.literal(true),
  })
  .strict();

export const commitOrderCostInput = z
  .object({
    basisVersion: z.number().int().positive(),
    confirmed: z.literal(true),
  })
  .strict();
