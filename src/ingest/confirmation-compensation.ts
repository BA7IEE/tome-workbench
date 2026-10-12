import { z } from "zod";
import { expectedVersion, safeText } from "../common/domain";
import { audit, event, hash, json, type Tx } from "../common/transaction";
import { Fault } from "../common/errors";
import { snapshot, versionMatch } from "../catalog/catalog.service";
import { correctionContract, correctionEvidence } from "./confirmation-correction";
import { tryCorrectionLocks } from "./correction-guards";

export const compensationInput = z.object({
  candidateVersion: expectedVersion,
  itemVersion: expectedVersion,
  purchaseLineVersion: expectedVersion.nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  code: z.string().regex(/^TM\d{6,}$/),
  reason: safeText(1000).min(3),
  confirmed: z.literal(true),
}).strict();
type Input = z.infer<typeof compensationInput>;

// A new executable endpoint leaves the certified read-only contract intact.
export async function compensationPreview(tx: Tx, candidateId: string, correctionId?: string) {
  const loaded = await correctionEvidence(tx, candidateId);
  const { candidate, item, line } = loaded;
  const active = await tx.ingestConfirmationCorrection.findFirst({
    where: { candidateId, restoredAt: null },
  });
  const evidence = structuredClone(loaded.evidence);
  const extra: { code: string; message: string }[] = [];
  if (correctionId) {
    const before = active?.beforeSnapshot as { candidate?: { possession?: string }; purchaseLine?: { possession?: string } } | undefined;
    if (!active || active.id !== correctionId || !item ||
        active.itemId !== item.id || active.sourceId !== candidate.sourceId ||
        active.purchaseLineId !== candidate.purchaseLineId ||
        candidate.decision !== "EXCLUDED" || !item.deletedAt || item.status !== "PAUSED" || item.approvedValid ||
        before?.candidate?.possession !== candidate.possession ||
        (line && (line.businessDecision !== "EXCLUDE" || before?.purchaseLine?.possession !== line.possession))) {
      extra.push({ code: "CORRECTION_STATE_CHANGED", message: "原组合撤销已经恢复或当前关联/状态不一致，请保留记录交管理员核对。" });
    } else {
      // Only after verifying the actual corrected state, reuse the same
      // original-proof and current-dependency checks for the proposed restore.
      evidence.candidate.decision = "CONFIRMED";
      evidence.item!.deleted = false;
      if (evidence.purchaseLine) evidence.purchaseLine.decision = "INCLUDE";
    }
  } else if (active) {
    extra.push({ code: "CORRECTION_ALREADY_ACTIVE", message: "该误确认已经撤销，请核对原记录的组合恢复。" });
  }
  const review = correctionContract(evidence);
  if (correctionId && active && review.originalConfirmationReceiptId !== active.originalReceiptId)
    extra.push({ code: "CORRECTION_PROOF_CHANGED", message: "原新建确认回执与纠错历史不一致，请保留记录核对。" });
  const blockers = [...extra, ...review.blockers];
  return {
    mode: correctionId ? "JOINT_RESTORE" : "SINGLE_COMPENSATION",
    executionAvailable: true,
    candidateEligible: blockers.length === 0,
    digest: hash({ evidence: review.digest, correctionId: correctionId || null,
      actualDecision: candidate.decision, actualDeleted: !!item?.deletedAt,
      actualPurchaseDecision: line?.businessDecision || null,
      correction: active ? { id: active.id, originalReceiptId: active.originalReceiptId, createdAt: active.createdAt.toISOString() } : null }),
    target: review.target,
    originalConfirmationReceiptId: review.originalConfirmationReceiptId,
    blockers,
  };
}

async function lockedPreview(tx: Tx, candidateId: string, input: Input, correctionId?: string) {
  const candidate = await tx.ingestCandidate.findUniqueOrThrow({ where: { id: candidateId }, include: { purchaseLine: { include: { order: true } } } });
  const source = candidate.sourceId ? await tx.source.findUnique({ where: { id: candidate.sourceId } }) : null;
  await tryCorrectionLocks(tx, [
    "ingest-candidate:" + candidateId,
    ...(candidate.itemId ? ["item:" + candidate.itemId] : []),
    ...(source ? ["source:" + source.id, "sourceKey:" + source.sourceKey] : []),
    ...(candidate.purchaseLine ? ["purchase-line:" + candidate.purchaseLine.id, "purchase-order:" + candidate.purchaseLine.orderId, `procurement-order:${candidate.purchaseLine.order.procurementSourceId}:${candidate.purchaseLine.order.externalOrderNo}`] : []),
  ]);
  const loaded = await correctionEvidence(tx, candidateId);
  if (loaded.candidate.itemId !== candidate.itemId || loaded.candidate.sourceId !== candidate.sourceId || loaded.candidate.purchaseLineId !== candidate.purchaseLineId)
    throw new Fault("VERSION_CONFLICT", "来源关联已变化，请重新核对", 409);
  versionMatch(loaded.candidate.version, input.candidateVersion);
  if (!loaded.item) throw new Fault("CORRECTION_NOT_ELIGIBLE", "当前没有可以核对的 TM", 409);
  versionMatch(loaded.item.version, input.itemVersion);
  if ((loaded.line?.version || null) !== input.purchaseLineVersion)
    throw new Fault("VERSION_CONFLICT", "采购行已变化，请重新核对", 409);
  const preview = await compensationPreview(tx, candidateId, correctionId);
  if (preview.digest !== input.digest || preview.target.code !== input.code)
    throw new Fault("CORRECTION_REVIEW_CHANGED", "核对内容或 TM 已变化，请保留输入并重新核对", 409);
  if (!preview.candidateEligible || !preview.originalConfirmationReceiptId)
    throw new Fault("CORRECTION_NOT_ELIGIBLE", preview.blockers.map(b => b.message).join("；"), 409);
  return { ...loaded, preview };
}

export async function compensateConfirmation(tx: Tx, actorId: string, candidateId: string, input: Input, correctionId?: string) {
  const { candidate, item, line, preview } = await lockedPreview(tx, candidateId, input, correctionId);
  const before = { candidate, item: { ...item!, ...await snapshot(tx, item!) }, purchaseLine: line };
  const now = new Date(), restoring = !!correctionId;
  const updatedItem = await tx.item.update({ where: { id: item!.id }, data: {
    deletedAt: restoring ? null : now, deletedBy: restoring ? null : actorId,
    deletionReason: restoring ? "" : input.reason, status: "PAUSED", approvedValid: false, version: { increment: 1 },
  } });
  const updatedCandidate = await tx.ingestCandidate.update({ where: { id: candidateId }, data: {
    decision: restoring ? "CONFIRMED" : "EXCLUDED", version: { increment: 1 },
  } });
  const updatedLine = line ? await tx.purchaseLine.update({ where: { id: line.id }, data: {
    businessDecision: restoring ? "INCLUDE" : "EXCLUDE", version: { increment: 1 },
  } }) : null;
  const after = { candidate: updatedCandidate, item: { ...updatedItem, ...await snapshot(tx, updatedItem) }, purchaseLine: updatedLine };
  const correction = restoring
    ? await tx.ingestConfirmationCorrection.update({ where: { id: correctionId! }, data: {
      restoredAt: now, restoredBy: actorId, restoreReason: input.reason, restoredSnapshot: json(after),
    } })
    : await tx.ingestConfirmationCorrection.create({ data: {
      candidateId, itemId: item!.id, sourceId: candidate.sourceId!, purchaseLineId: candidate.purchaseLineId,
      originalReceiptId: preview.originalConfirmationReceiptId!, reason: input.reason, createdBy: actorId,
      beforeSnapshot: json(before), correctedSnapshot: json(after),
    } });
  await tx.itemRevision.create({ data: { itemId: item!.id, version: updatedItem.version, snapshot: json(await snapshot(tx, updatedItem)) } });
  await tx.ingestCandidateRevision.create({ data: { candidateId, version: updatedCandidate.version, snapshot: json(updatedCandidate) } });
  if (updatedLine) await tx.purchaseLineRevision.create({ data: { lineId: updatedLine.id, version: updatedLine.version, snapshot: json(updatedLine) } });
  await audit(tx, actorId, restoring ? "INGEST_CONFIRMATION_RESTORED" : "INGEST_CONFIRMATION_REVOKED", candidateId, {
    correctionId: correction.id, reason: input.reason, originalReceiptId: correction.originalReceiptId, before, after,
  });
  await event(tx, item!.id, restoring ? "ITEM_RESTORED" : "ITEM_TRASHED", { correctionId: correction.id });
  return { id: candidateId, correctionId: correction.id, itemId: item!.id, code: input.code,
    candidateVersion: updatedCandidate.version, itemVersion: updatedItem.version,
    purchaseLineVersion: updatedLine?.version || null, decision: updatedCandidate.decision,
    status: "PAUSED", automaticallyPublish: false };
}
