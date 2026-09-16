import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Access, AuthRequest, permission } from "../auth/auth";
import { Commands, audit, event } from "../common/transaction";
import { Fault } from "../common/errors";
import { safeText, uuid } from "../common/domain";
import { PrismaService } from "../database/prisma.service";
import { itemLock } from "../catalog/catalog.service";
import { assetPath, prepareImage, imageCommand } from "./storage";
import { UploadBudget } from "./upload-budget";
export { assetPath } from "./storage";
@ApiTags("素材")
@Controller("api/assets")
export class MediaController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("edit")
  @Post("upload")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    UploadBudget,
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 8 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        itemId: uuid,
        role: z
          .enum([
            "PRODUCT",
            "DETAIL",
            "DEFECT",
            "REFERENCE",
            "DOCUMENT",
            "AI_MARKETING",
          ])
          .default("PRODUCT"),
        origin: z.enum(["OWN", "SUPPLIER", "REFERENCE", "AI"]).default("OWN"),
        sourceNote: safeText(2000).default(""),
      })
      .strict()
      .parse(raw);
    if (
      ["AI", "REFERENCE"].includes(b.origin) &&
      !["REFERENCE", "AI_MARKETING"].includes(b.role)
    )
      throw new Fault(
        "INVALID_ORIGIN",
        "AI或参考资料不能声明为实物交易图片",
        400,
      );
    const prepared = await prepareImage(file);
    const data = { ...b, ...prepared.metadata };
    const sha256 = prepared.metadata.sha256;
    return imageCommand(this.db, prepared, (persist) =>
      this.commands.run(
        r.actor.id,
        "asset.upload",
        r.get("Idempotency-Key"),
        data,
        async (tx) => {
          await itemLock(tx, b.itemId);
          const last = await tx.asset.aggregate({
            where: { itemId: b.itemId },
            _max: { position: true },
          });
          const { objectKey } = await persist(tx);
          const asset = await tx.asset.create({
            data: {
              ...data,
              objectKey,
              position: Math.min(999, (last._max.position ?? -1) + 1),
            },
          });
          await audit(tx, r.actor.id, "ASSET_UPLOADED", b.itemId, {
            assetId: asset.id,
            sha256,
          });
          await event(tx, b.itemId);
          return { id: asset.id };
        },
      ),
    );
  }
  @Access("read") @Get(":id/preview") async preview(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const a = await this.db.asset.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    if (a.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(await readFile(assetPath(a.objectKey) + ".webp"));
  }
  @Access("read") @Get(":id/original") async original(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const a = await this.db.asset.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    if (a.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    res
      .set({
        "Content-Type": a.mime,
        "Content-Disposition": `attachment; filename="${a.id}.${a.mime.split("/")[1]}"`,
        "Cache-Control": "private, no-store",
      })
      .send(await readFile(assetPath(a.objectKey)));
  }
  @Access("review") @Post(":id/review") async review(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    uuid.parse(id);
    const b = z
      .object({
        rights: z.enum(["INTERNAL", "PUBLIC", "REVOKED"]),
        verified: z.boolean(),
        sourceNote: safeText(2000).min(1),
        validUntil: z.string().datetime().nullable().default(null),
        position: z.number().int().min(0).max(1000).default(0),
      })
      .strict()
      .parse(raw);
    const a = await this.db.asset.findUniqueOrThrow({ where: { id } });
    return this.commands.run(
      r.actor.id,
      "asset.review",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await itemLock(tx, a.itemId);
        const current = await tx.asset.findUniqueOrThrow({ where: { id } });
        if (
          (["DOCUMENT", "REFERENCE", "AI_MARKETING"].includes(current.role) ||
            ["AI", "REFERENCE"].includes(current.origin) ||
            current.archived) &&
          b.rights === "PUBLIC"
        )
          throw new Fault(
            "PUBLIC_ROLE_DENIED",
            "本版凭证、参考图与AI图不能作为公开交易图片",
            400,
          );
        await tx.asset.update({
          where: { id },
          data: {
            ...b,
            validUntil: b.validUntil ? new Date(b.validUntil) : null,
          },
        });
        await audit(tx, r.actor.id, "ASSET_REVIEWED", a.itemId, {
          assetId: id,
          rights: b.rights,
        });
        await event(tx, a.itemId, "RIGHTS_CHANGED");
        return { id };
      },
    );
  }
}
