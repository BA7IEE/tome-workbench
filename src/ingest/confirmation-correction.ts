import type { Tx } from "../common/transaction";
import { hash } from "../common/transaction";
import { Fault } from "../common/errors";
import { tm } from "../common/domain";

export type Evidence = {
  sourceVersion?: number | null;
  candidate: {
    id: string;
    version: number;
    decision: string;
    itemId: string | null;
    sourceId: string | null;
    purchaseLineId: string | null;
  };
  item: {
    id: string;
    version: number;
    serial: number;
    sourceId: string | null;
    deleted: boolean;
    dataMode: string;
    status: string;
    cycle: number;
  } | null;
  receipts: { id: string; operation: string; response: unknown }[];
  singleSource: boolean;
  singleCandidate: boolean;
  singlePurchase: boolean;
  purchaseLine: {
    id: string;
    version: number;
    decision: string;
    orderId: string;
    orderVersion: number;
  } | null;
  dependencies: Record<string, number>;
};
const dependencyNames: Record<string, string> = {
  sales: "成交或退款历史",
  costEntries: "成本记录",
  reservations: "客户预留历史",
  observations: "库存观察或冲突",
  inquiries: "客户询盘",
  movements: "保管或实物移动",
  listings: "远端身份记录",
  distributionTargets: "分发目标",
  distributionAttempts: "分发交付历史",
  publishingDrafts: "发布草稿",
  packages: "已生成资料包",
  materialExports: "资料导出",
  offers: "供应商报价",
  intents: "经营异常处理",
  tasks: "经营待办",
  suggestions: "已记录建议",
  waivers: "发布豁免",
  channelPrices: "渠道报价",
  aliases: "额外身份别名",
  collectionEntries: "选品关联",
  purchaseConfirmations: "整单逐件成本确认历史",
  orderCostBasis: "整单成本分摊依据",
  orderItemCosts: "同订单其他商品成本",
  purchaseReturns: "采购退货关联",
};

/** A review contract only. Neither eligibility nor this digest authorizes writes. */
export function correctionContract(evidence: Evidence) {
  const { candidate, item } = evidence;
  const blockers: { code: string; message: string }[] = [];
  const block = (code: string, message: string) =>
    blockers.push({ code, message });
  if (
    candidate.decision !== "CONFIRMED" ||
    !item ||
    candidate.itemId !== item.id
  )
    block("NOT_CONFIRMED", "候选当前没有明确的已确认 TM，请先核对来源决定。");
  const proofs = evidence.receipts.filter((receipt) => {
    if (receipt.operation !== "ingest.candidate.confirm") return false;
    const response = receipt.response;
    if (!response || typeof response !== "object" || Array.isArray(response))
      return false;
    const r = response as Record<string, unknown>;
    return (
      r.id === candidate.id &&
      r.itemId === item?.id &&
      r.existing === false &&
      r.code === (item ? tm(item.serial) : "") &&
      Number.isInteger(r.version) &&
      Number(r.version) >= 2 &&
      Number(r.version) <= candidate.version
    );
  });
  if (proofs.length !== 1)
    block(
      "CREATION_PROOF_MISSING",
      "不能唯一证明本候选直接新建了 TM。关联、复用或缺历史回执的商品不能自动撤销。",
    );
  if (
    !candidate.sourceId ||
    item?.sourceId !== candidate.sourceId ||
    !evidence.singleSource ||
    !evidence.singleCandidate
  )
    block(
      "SHARED_OWNERSHIP",
      "来源或候选归属不是单一且一致的；不能自动删除共享 TM 或搬移关联。",
    );
  if (
    !evidence.singlePurchase ||
    (candidate.purchaseLineId &&
      (!evidence.purchaseLine ||
        evidence.purchaseLine.id !== candidate.purchaseLineId ||
        evidence.purchaseLine.decision !== "INCLUDE"))
  )
    block("PURCHASE_LINK_CHANGED", "采购行、纳入决定或商品关联需要人工核对。");
  if (
    item &&
    (item.deleted ||
      item.dataMode !== "BUSINESS" ||
      !["AVAILABLE", "PAUSED"].includes(item.status) ||
      item.cycle !== 1)
  )
    block(
      "ITEM_PROTECTED",
      "商品已退出、属于 TEST、库存状态受保护或已有后续经营周期。",
    );
  for (const [key, label] of Object.entries(dependencyNames)) {
    const count = evidence.dependencies[key];
    if (!Number.isSafeInteger(count) || count < 0)
      block("DEPENDENCY_UNKNOWN", `${label}未完成核对，不能自动撤销。`);
    else if (count > 0)
      block(
        "HAS_" + key.toUpperCase(),
        `存在${label}，需保留事实并由管理员核对。`,
      );
  }
  return {
    mode: "REVIEW_ONLY" as const,
    executionAvailable: false as const,
    candidateEligible: blockers.length === 0,
    digest: hash({
      ...evidence,
      dependencies: Object.fromEntries(
        Object.keys(dependencyNames).map((key) => {
          const count = evidence.dependencies[key];
          return [
            key,
            Number.isSafeInteger(count) && count >= 0 ? count : null,
          ];
        }),
      ),
    }),
    target: {
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      itemId: item?.id || null,
      itemVersion: item?.version || null,
      code: item ? tm(item.serial) : null,
      purchaseLine: evidence.purchaseLine,
    },
    originalConfirmationReceiptId: proofs.length === 1 ? proofs[0].id : null,
    blockers,
    proposedTransition: blockers.length
      ? null
      : {
          candidate: {
            decision: "EXCLUDED",
            preserveItemId: true,
            preservePossession: true,
          },
          item: {
            deleted: true,
            status: "PAUSED",
            approvedValid: false,
            preserveSerial: true,
            preserveOriginalFiles: true,
          },
          purchaseLine: evidence.purchaseLine
            ? { businessDecision: "EXCLUDE" }
            : null,
          restore: {
            sameItem: true,
            candidateDecision: "CONFIRMED",
            purchaseDecision: "INCLUDE",
            status: "PAUSED",
            approvedValid: false,
            automaticallyPublish: false,
          },
          transactionRequirements: [
            "financial-journal first",
            "nonblocking resource locks",
            "recheck all current versions and dependencies",
            "append correction history, revisions, audit, receipt and outbox atomically",
            "guard old partial restore and costing paths",
          ],
        },
  };
}

export async function correctionEvidence(tx: Tx, id: string) {
  const candidate = await tx.ingestCandidate.findUnique({
    where: { id },
    include: { purchaseLine: { include: { order: true, returnLinks: true } } },
  });
  if (!candidate) throw new Fault("CANDIDATE_NOT_FOUND", "来源候选不存在", 404);
  const item = candidate.itemId
    ? await tx.item.findUnique({
        where: { id: candidate.itemId },
        include: {
          source: { select: { purchaseLineId: true, version: true } },
          sourceLinks: true,
          purchaseLinks: true,
          _count: true,
        },
      })
    : null;
  const receipts = item
    ? await tx.receipt.findMany({
        where: {
          operation: "ingest.candidate.confirm",
          AND: [
            { response: { path: ["id"], equals: id } },
            { response: { path: ["itemId"], equals: item.id } },
            { response: { path: ["existing"], equals: false } },
          ],
        },
        select: { id: true, operation: true, response: true },
        take: 2,
      })
    : [];
  const line = candidate.purchaseLine;
  const [
    candidateCount,
    sourceLinkCount,
    primaryItemCount,
    collectionEntries,
    purchaseConfirmations,
    orderCostBasis,
    orderItemCosts,
  ] = await Promise.all([
    item
      ? tx.ingestCandidate.count({
          where: {
            OR: [
              { itemId: item.id },
              ...(candidate.sourceId ? [{ sourceId: candidate.sourceId }] : []),
            ],
          },
        })
      : 0,
    candidate.sourceId
      ? tx.itemSourceLink.count({ where: { sourceId: candidate.sourceId } })
      : 0,
    candidate.sourceId ? tx.item.count({ where: { sourceId: candidate.sourceId } }) : 0,
    item ? tx.collectionEntry.count({ where: { itemId: item.id } }) : 0,
    line
      ? tx.purchaseCostConfirmation.count({
          where: { purchaseLine: { orderId: line.orderId } },
        })
      : 0,
    line
      ? tx.purchaseOrderCostBasis.count({ where: { orderId: line.orderId } })
      : 0,
    line
      ? tx.costEntry.count({
          where: {
            item: {
              purchaseLinks: {
                some: { purchaseLine: { orderId: line.orderId } },
              },
            },
          },
        })
      : 0,
  ]);
  const evidence: Evidence = {
    sourceVersion: item?.source?.version || null,
    candidate: {
      id: candidate.id,
      version: candidate.version,
      decision: candidate.decision,
      itemId: candidate.itemId,
      sourceId: candidate.sourceId,
      purchaseLineId: candidate.purchaseLineId,
    },
    item: item
      ? {
          id: item.id,
          version: item.version,
          serial: item.serial,
          sourceId: item.sourceId,
          deleted: !!item.deletedAt,
          dataMode: item.dataMode,
          status: item.status,
          cycle: item.cycle,
        }
      : null,
    receipts,
    singleCandidate: candidateCount === 1,
    singleSource:
      sourceLinkCount === 1 && primaryItemCount === 1 &&
      item?.sourceLinks.length === 1 &&
      item.sourceLinks[0].sourceId === candidate.sourceId &&
      item.sourceLinks[0].kind === "ACQUISITION" &&
      item.source?.purchaseLineId === candidate.purchaseLineId,
    singlePurchase:
      !!item &&
      (line
        ? item.purchaseLinks.length === 1 &&
          item.purchaseLinks[0].purchaseLineId === line.id
        : item.purchaseLinks.length === 0),
    purchaseLine: line
      ? {
          id: line.id,
          version: line.version,
          decision: line.businessDecision,
          orderId: line.orderId,
          orderVersion: line.order.version,
        }
      : null,
    dependencies: Object.fromEntries(
      Object.keys(dependencyNames).map((key) => [
        key,
        key === "collectionEntries"
          ? collectionEntries
          : key === "purchaseConfirmations"
          ? purchaseConfirmations
          : key === "orderCostBasis"
            ? orderCostBasis
            : key === "orderItemCosts"
              ? orderItemCosts
              : key === "purchaseReturns"
                ? line?.returnLinks.length || 0
                : (item?._count[key as keyof typeof item._count] ??
                  (item ? NaN : 0)),
      ]),
    ),
  };
  return { evidence, candidate, item, line };
}

export async function confirmationCorrectionPreview(tx: Tx, id: string) {
  return correctionContract((await correctionEvidence(tx, id)).evidence);
}
