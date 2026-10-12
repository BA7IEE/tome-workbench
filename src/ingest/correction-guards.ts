import { Prisma } from "@prisma/client";
import type { Tx } from "../common/transaction";
import { Fault } from "../common/errors";

export async function assertNoActiveCorrection(tx: Tx, key: "itemId" | "candidateId" | "purchaseLineId", id: string) {
  const active = await tx.ingestConfirmationCorrection.findFirst({
    where: { [key]: id, restoredAt: null }, select: { id: true },
  });
  if (active) throw new Fault("CONFIRMATION_CORRECTION_ACTIVE", "该记录有活动的误确认纠错，请使用专用组合恢复核对；不能单独恢复商品、候选或采购决定。", 409);
}

/** Called inside Commands, after its financial-journal and receipt boundary.
 * Never wait behind a resource lock held by an older inverse-order command. */
export async function tryCorrectionLocks(tx: Tx, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    const result = await tx.$queryRaw<{ acquired: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}::text,0)) AS acquired`);
    if (!result[0]?.acquired) throw new Fault("CORRECTION_RESOURCE_BUSY", "商品或来源正在处理，请保留本次内容稍后重新核对。", 409);
  }
}
