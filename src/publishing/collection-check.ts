import { PrismaService } from "../database/prisma.service";
import { packageContext } from "./publishing.service";
import { requirements, tm } from "../common/domain";
import { Fault } from "../common/errors";
/** Read-only check for the exact no-draft CUSTOMER_CARD path. Commit still rechecks every package. */
export async function checkCollection(
  db: PrismaService,
  itemIds: string[],
  channelId: string,
) {
  const rows = [];
  for (const id of itemIds) {
    try {
      const result = await db.$transaction(async (tx) => {
        const c = await packageContext(tx, id, channelId, true);
        const missing = requirements({
          title: c.approved!.title,
          brand: c.approved!.brand,
          category: c.approved!.category,
          facts: c.facts,
          assetCount: c.assets.length,
          exemptions: c.waivers.map((w) => w.code),
          english: c.channel.locale === "en",
          trade: false,
          offerValid: !!c.validOffer,
          ownership: c.item.ownership,
          price: c.price.amount,
          currency: c.price.currency,
          status: c.item.status,
        });
        const issues = missing.map((m) => m.title);
        if (c.item.status !== "AVAILABLE") issues.push("商品当前不可售");
        if (c.assets.length > 40)
          issues.push("可用图片超过40张，请在商品中整理素材");
        if (c.item.dataMode !== "BUSINESS")
          issues.push("客户选品只接收正式商品");
        return { id, code: tm(c.item.serial), issues };
      });
      rows.push(result);
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      rows.push({ id, code: "", issues: [e.message] });
    }
  }
  return { rows, ready: rows.every((r) => !r.issues.length) };
}
