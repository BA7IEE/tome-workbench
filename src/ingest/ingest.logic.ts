import { type Tx } from "../common/transaction";
import { normalizeTerm } from "../dictionaries/dictionary-rules";
import type { z } from "zod";
import { ingestCandidateInput } from "./ingest.schemas";

type CandidateInput = z.infer<typeof ingestCandidateInput>;

export function mapTopCategory(raw: string) {
  const value = raw.normalize("NFKC").toLowerCase();
  if (/(?:^|[\/›>])\s*(?:clothing|服装)(?:\s*[\/›>]|$)/i.test(value))
    return "CLOTHING";
  if (
    /(?:^|[\/›>])\s*(?:bags?|handbags?|包袋|包包)(?:\s*[\/›>]|$)/i.test(value)
  )
    return "BAG";
  if (/(?:^|[\/›>])\s*(?:shoes?|footwear|鞋履|鞋)(?:\s*[\/›>]|$)/i.test(value))
    return "SHOES";
  if (
    /(?:^|[\/›>])\s*(?:accessories|accessory|配饰)(?:\s*[\/›>]|$)/i.test(value)
  )
    return "ACCESSORY";
  return "OTHER";
}

export async function proposalFor(tx: Tx, input: CandidateInput) {
  const category = mapTopCategory(input.categoryRaw),
    warnings: string[] = [];
  let brandEntryId: string | null = null,
    brandLabel = "";
  if (input.brandRaw) {
    const term = await tx.dictionaryTerm.findUnique({
      where: {
        kind_normalized: {
          kind: "BRAND",
          normalized: normalizeTerm(input.brandRaw),
        },
      },
      include: { entry: true },
    });
    if (term?.entry.active) {
      brandEntryId = term.entryId;
      brandLabel = term.entry.label;
    } else warnings.push(`品牌“${input.brandRaw}”尚未标准化`);
  }
  if (category === "OTHER" && input.categoryRaw)
    warnings.push(`品类“${input.categoryRaw}”需要人工确认一级分类`);
  if (input.conditionRaw) warnings.push("来源成色仅作参考，未映射成本地成色");
  return {
    proposal: { title: input.titleRaw, brandEntryId, brandLabel, category },
    warnings,
  };
}
