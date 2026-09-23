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
  const agentFields = input.agentProposal?.fields || [],
    field = (path: (typeof agentFields)[number]["path"]) =>
      agentFields.find((candidate) => candidate.path === path)?.value,
    category = field("category") || mapTopCategory(input.categoryRaw),
    suggestedBrand = field("brand") || input.brandRaw,
    warnings: string[] = [];
  let brandEntryId: string | null = null,
    brandLabel = "";
  if (suggestedBrand) {
    const term = await tx.dictionaryTerm.findUnique({
      where: {
        kind_normalized: {
          kind: "BRAND",
          normalized: normalizeTerm(suggestedBrand),
        },
      },
      include: { entry: true },
    });
    if (term?.entry.active) {
      brandEntryId = term.entryId;
      brandLabel = term.entry.label;
    } else warnings.push(`品牌“${suggestedBrand}”尚未标准化`);
  }
  if (category === "OTHER" && input.categoryRaw)
    warnings.push(`品类“${input.categoryRaw}”需要人工确认一级分类`);
  if (agentFields.length) {
    warnings.push("含外部Agent整理建议，生成TM前请人工核对");
    const uncertain = agentFields.filter(
      (candidate) =>
        candidate.confidence < 1 || candidate.method === "INFERRED",
    ).length;
    if (uncertain) warnings.push(`${uncertain}项Agent建议标记为存疑或推断`);
  }
  const facts = Object.fromEntries(
    agentFields
      .filter((candidate) => candidate.path.startsWith("facts."))
      .map((candidate) => [
        candidate.path.slice("facts.".length),
        candidate.value,
      ]),
  );
  return {
    proposal: {
      title: field("title") || input.titleRaw,
      brandEntryId,
      brandLabel,
      suggestedBrand,
      category,
      facts,
      ...(input.agentProposal
        ? {
            agent: {
              generator: input.agentProposal.generator,
              model: input.agentProposal.model,
              generatedAt: input.agentProposal.generatedAt,
            },
            agentFields,
          }
        : {}),
    },
    warnings,
  };
}
