import type { Item } from "@prisma/client";
import { type Tx, audit, event } from "../common/transaction";
import { factsSchema } from "../common/domain";
import { Fault } from "../common/errors";
export function approvalBlockers(item: Pick<Item, "facts">) {
  const f = factsSchema.parse(item.facts);
  return [
    ...(f.authentication.status === "PASSED" && !f.authentication.evidence
      ? [
          {
            code: "authentication_evidence",
            title: "真实性复核通过必须保留依据",
          },
        ]
      : []),
    ...(f.research.some((r) => r.confirmed && !r.evidence)
      ? [{ code: "research_evidence", title: "已确认的研究结论必须附依据" }]
      : []),
  ];
}
/** Caller must hold the item lock and verify current version and review permission. */
export async function approveRevision(tx: Tx, item: Item, actorId: string) {
  const blockers = approvalBlockers(item);
  if (blockers.length)
    throw new Fault("EVIDENCE_REQUIRED", blockers[0].title, 400);
  const revision = await tx.itemRevision.update({
    where: { itemId_version: { itemId: item.id, version: item.version } },
    data: { approvedBy: actorId, approvedAt: new Date() },
  });
  await tx.item.update({
    where: { id: item.id },
    data: { approvedId: revision.id, approvedValid: true },
  });
  await audit(tx, actorId, "ITEM_APPROVED", item.id, { version: item.version });
  await event(tx, item.id);
  return {
    id: item.id,
    approvedVersion: item.version,
    approvedId: revision.id,
  };
}
