import { checkCollection } from "./collection-check";
import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { access } from "node:fs/promises";
import archiver from "archiver";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit } from "../common/transaction";
import { itemLock } from "../catalog/catalog.service";
import { safeText, uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { assetPath } from "../media/storage";
import { PublishingService } from "./publishing.service";
@Controller("api/collections")
export class CollectionsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private publishing: PublishingService,
  ) {}
  @Access("read") @Get() list() {
    return this.db.collection.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { entries: true } } },
    });
  }
  @Access("publish") @Post("preflight") preflight(@Body() raw: unknown) {
    const b = z
      .object({ itemIds: z.array(uuid).min(1).max(40), channelId: uuid })
      .strict()
      .parse(raw);
    if (new Set(b.itemIds).size !== b.itemIds.length)
      throw new Fault("DUPLICATE_ITEM", "选择的商品不能重复", 400);
    return checkCollection(this.db, b.itemIds, b.channelId);
  }
  @Access("publish") @Post() create(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        title: safeText(200).min(1),
        packageIds: z.array(uuid).min(1).max(40),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    if (new Set(b.packageIds).size !== b.packageIds.length)
      throw new Fault("DUPLICATE_PACKAGE", "使用包不能重复", 400);
    return this.commands.run(
      r.actor.id,
      "collection.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const packs = await tx.usePackage.findMany({
          where: { id: { in: b.packageIds } },
        });
        if (
          packs.length !== b.packageIds.length ||
          new Set(packs.map((p) => p.itemId)).size !== packs.length
        )
          throw new Fault(
            "COLLECTION_IDENTITY",
            "使用包不存在或同一实物被重复选择",
            400,
          );
        for (const id of packs.map((p) => p.itemId).sort())
          await itemLock(tx, id);
        for (const id of b.packageIds)
          await this.publishing.validPackage(tx, id);
        const collection = await tx.collection.create({
          data: { title: b.title, createdBy: r.actor.id },
        });
        for (const [position, id] of b.packageIds.entries()) {
          const p = packs.find((p) => p.id === id)!;
          await tx.collectionEntry.create({
            data: {
              collectionId: collection.id,
              packageId: id,
              itemId: p.itemId,
              channelId: p.channelId,
              position,
            },
          });
        }
        await audit(tx, r.actor.id, "COLLECTION_CREATED", collection.id, {
          count: packs.length,
        });
        return { id: collection.id };
      },
    );
  }
  private async projection(id: string) {
    const c = await this.db.collection.findUnique({
      where: { id: uuid.parse(id) },
      include: { entries: { orderBy: { position: "asc" } } },
    });
    if (!c) throw new Fault("NOT_FOUND", "选品合集不存在", 404);
    const entries = [];
    for (const e of c.entries) {
      try {
        const valid = await this.db.$transaction((tx) =>
          this.publishing.validPackage(tx, e.packageId),
        );
        entries.push({ entry: e, valid });
      } catch (error) {
        if (!(error instanceof Fault)) throw error;
        entries.push({ entry: e, valid: null });
      }
    }
    return { c, entries };
  }
  @Access("read") @Get(":id") async detail(@Param("id") id: string) {
    const { c, entries } = await this.projection(id);
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      entries: entries.map(({ entry, valid }) => ({
        id: entry.id,
        itemId: entry.itemId,
        packageId: entry.packageId,
        status: valid ? "USABLE" : "WITHHELD",
        snapshot: valid?.s || null,
      })),
    };
  }
  @Access("publish") @Get(":id/download") async download(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { c, entries } = await this.projection(id);
    const active = entries.flatMap((e) => (e.valid ? [e.valid] : []));
    if (!active.length)
      throw new Fault("NO_USABLE_ITEMS", "合集当前没有可取用商品");
    for (const v of active)
      for (const a of v.assets) await access(assetPath(a.objectKey) + ".webp");
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="collection-${id.slice(0, 8)}.zip"`,
      "Cache-Control": "no-store",
    });
    const zip = archiver("zip", { zlib: { level: 6 } });
    zip.on("error", () => res.destroy());
    zip.on("warning", () => res.destroy());
    zip.pipe(res);
    zip.append(
      JSON.stringify(
        {
          title: c.title,
          exportedAt: new Date(),
          withheldCount: entries.length - active.length,
          items: active.map((v) => v.s),
        },
        null,
        2,
      ),
      { name: "collection.json" },
    );
    for (const v of active) {
      zip.append(v.s.title + "\n\n" + v.s.body, {
        name: v.s.code + "/description.txt",
      });
      for (const [i, a] of v.assets.entries())
        zip.file(assetPath(a.objectKey) + ".webp", {
          name: `${v.s.code}/${String(i + 1).padStart(2, "0")}.webp`,
        });
    }
    await zip.finalize();
  }
}
