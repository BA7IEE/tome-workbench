import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { Commands, audit, json } from "../common/transaction";
import { expectedVersion, factsSchema, safeText, uuid } from "../common/domain";
import { itemLock, snapshot, versionMatch } from "../catalog/catalog.service";
import { Fault } from "../common/errors";
@ApiTags("内容建议（人工可独立运行）")
@Controller("api")
export class AiController {
  constructor(private commands: Commands) {}
  @Access("read") @Get("ai/status") status() {
    return { enabled: false, mode: "DRAFT_ONLY", manualImport: true };
  }
  @Access("edit") @Post("items/:id/suggestions") async suggest(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        version: expectedVersion,
        locale: z.enum(["zh-CN", "en"]),
        text: safeText(12000).min(1),
        source: safeText(120).default("MANUAL_IMPORT"),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "suggestion.import",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        versionMatch(item.version, b.version);
        const s = await tx.suggestion.create({
          data: {
            itemId: id,
            inputVersion: item.version,
            locale: b.locale,
            text: b.text,
            source: b.source,
          },
        });
        await audit(tx, r.actor.id, "SUGGESTION_CREATED", id, {
          suggestionId: s.id,
        });
        return { id: s.id };
      },
    );
  }
  @Access("edit") @Post("items/:id/ai-draft") async ai(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    uuid.parse(id);
    void raw;
    void r;
    throw new Fault(
      "AI_DISABLED",
      "本版联网AI连接器未验收，禁止实际调用；支持导入AI草稿、版本校验及人工接受",
      503,
    );
  }
  @Access("edit") @Post("suggestions/:id/apply") async apply(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    uuid.parse(id);
    return this.commands.run(
      r.actor.id,
      "suggestion.apply",
      r.get("Idempotency-Key"),
      { id },
      async (tx) => {
        const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
        const item = await itemLock(tx, s.itemId);
        versionMatch(item.version, s.inputVersion);
        if (s.status !== "PENDING")
          throw new Fault("SUGGESTION_UNAVAILABLE", "建议已使用或失效");
        const f = factsSchema.parse(item.facts);
        if (s.locale === "en") f.descriptionEn = s.text;
        else f.descriptionZh = s.text;
        const updated = await tx.item.update({
          where: { id: item.id },
          data: { facts: json(f), version: { increment: 1 } },
        });
        await tx.itemRevision.create({
          data: {
            itemId: item.id,
            version: updated.version,
            snapshot: json(await snapshot(tx, updated)),
          },
        });
        await tx.suggestion.update({
          where: { id },
          data: { status: "APPLIED" },
        });
        await audit(tx, r.actor.id, "SUGGESTION_APPLIED_TO_DRAFT", item.id, {
          suggestionId: id,
        });
        return { id: item.id };
      },
    );
  }
}
