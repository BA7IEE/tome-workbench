import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { Commands, audit, event, lock } from "../common/transaction";
import { safeText, uuid } from "../common/domain";
import { itemLock } from "./catalog.service";
import { Fault } from "../common/errors";
@Controller("api/items")
export class CatalogExtensionsController {
  constructor(private commands: Commands) {}
  @Access("edit") @Post(":id/aliases") alias(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({ code: safeText(32).min(3), source: safeText(300).min(1) })
      .strict()
      .parse(raw);
    const code = b.code.normalize("NFKC").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) || /^TM\d+$/.test(code))
      throw new Fault(
        "ALIAS_RESERVED",
        "别名限3—32位字母数字下划线连字符；TM数字空间保留给主编号",
        400,
      );
    return this.commands.run(
      r.actor.id,
      "item.alias",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), code, source: b.source },
      async (tx) => {
        await itemLock(tx, id);
        await lock(tx, "alias:" + code);
        const old = await tx.itemAlias.findUnique({ where: { code } });
        if (old && old.itemId !== id)
          throw new Fault("ALIAS_CONFLICT", "此编号已经属于另一件商品");
        if (old) return { id, code, existing: true };
        await tx.itemAlias.create({
          data: { code, itemId: id, source: b.source, createdBy: r.actor.id },
        });
        await audit(tx, r.actor.id, "ITEM_ALIAS_ADDED", id, {
          code,
          source: b.source,
        });
        return { id, code };
      },
    );
  }
  @Access("review") @Post(":id/waivers") waiver(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        code: z.literal("measurements"),
        reason: safeText(2000).min(10),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "item.waiver",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        const old = await tx.requirementWaiver.findFirst({
          where: {
            itemId: id,
            code: b.code,
            status: "ACTIVE",
            category: item.category,
          },
        });
        if (old) return { id: old.id, existing: true };
        const row = await tx.requirementWaiver.create({
          data: {
            ...b,
            itemId: id,
            category: item.category,
            createdBy: r.actor.id,
          },
        });
        await audit(tx, r.actor.id, "REQUIREMENT_NOT_APPLICABLE", id, {
          waiverId: row.id,
          code: b.code,
          reason: b.reason,
        });
        await event(tx, id);
        return { id: row.id };
      },
    );
  }
  @Access("review") @Post(":id/waivers/:waiverId/revoke") revoke(
    @Param("id") id: string,
    @Param("waiverId") waiverId: string,
    @Req() r: AuthRequest,
  ) {
    return this.commands.run(
      r.actor.id,
      "item.waiver.revoke",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), waiverId: uuid.parse(waiverId) },
      async (tx) => {
        await itemLock(tx, id);
        const n = await tx.requirementWaiver.updateMany({
          where: { id: waiverId, itemId: id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
        if (n.count !== 1)
          throw new Fault("WAIVER_NOT_ACTIVE", "不适用决定不存在或已撤销");
        await audit(tx, r.actor.id, "REQUIREMENT_WAIVER_REVOKED", id, {
          waiverId,
        });
        await event(tx, id);
        return { id: waiverId };
      },
    );
  }
}
