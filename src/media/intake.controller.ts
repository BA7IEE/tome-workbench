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
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Access, AuthRequest, permission } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, event, lock } from "../common/transaction";
import { itemLock } from "../catalog/catalog.service";
import { safeText, uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { assetPath, prepareImage, imageCommand } from "./storage";
import { UploadBudget } from "./upload-budget";
@Controller("api/intake")
@Access("edit")
export class IntakeController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Get("batches") batches() {
    return this.db.intakeBatch.findMany({
      include: { _count: { select: { files: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
  @Post("batches") create(@Body() raw: unknown, @Req() r: AuthRequest) {
    const b = z
      .object({ name: safeText(200).min(1) })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "intake.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const row = await tx.intakeBatch.create({
          data: { ...b, createdBy: r.actor.id },
        });
        await audit(tx, r.actor.id, "INTAKE_CREATED", row.id);
        return { id: row.id };
      },
    );
  }
  @Get("batches/:id") async detail(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    const batch = await this.db.intakeBatch.findUnique({
      where: { id: uuid.parse(id) },
      include: {
        files: {
          orderBy: { createdAt: "asc" },
          include: {
            asset: { select: { id: true, itemId: true, role: true } },
          },
        },
      },
    });
    if (!batch) throw new Fault("NOT_FOUND", "批次不存在", 404);
    return {
      ...batch,
      files: batch.files.filter(
        (f) =>
          f.asset?.role !== "DOCUMENT" || permission(r.actor.role, "finance"),
      ),
    };
  }
  @Post("batches/:id/upload")
  @UseInterceptors(
    UploadBudget,
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 },
    }),
  )
  async upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() r: AuthRequest,
  ) {
    uuid.parse(id);
    const batch = await this.db.intakeBatch.findUnique({ where: { id } });
    if (!batch || batch.state !== "OPEN")
      throw new Fault("BATCH_CLOSED", "批次不可上传");
    const prepared = await prepareImage(file),
      data = prepared.metadata;
    const codes = [
      ...new Set(
        [
          ...data.originalName.matchAll(
            /(?:^|[^A-Z0-9])(TM[0-9]{6,})(?=$|[^A-Z0-9])/gi,
          ),
        ].map((m) => m[1].toUpperCase()),
      ),
    ];
    const hint = codes.length === 1 ? codes[0] : "";
    return imageCommand(this.db, prepared, (persist) =>
      this.commands.run(
        r.actor.id,
        "intake.upload",
        r.get("Idempotency-Key"),
        { batchId: id, ...data },
        async (tx) => {
          await lock(tx, "intake:" + id);
          const current = await tx.intakeBatch.findUniqueOrThrow({
            where: { id },
          });
          if (current.state !== "OPEN")
            throw new Fault("BATCH_CLOSED", "批次已关闭");
          const stored = await persist(tx);
          const row = await tx.intakeFile.create({
            data: { ...stored, batchId: id, hint, createdBy: r.actor.id },
          });
          await audit(tx, r.actor.id, "INTAKE_FILE_ADDED", id, {
            fileId: row.id,
            sha256: stored.sha256,
          });
          return { id: row.id, hint, automaticBinding: false };
        },
      ),
    );
  }
  @Get("files/:id/preview") async preview(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const row = await this.db.intakeFile.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: { asset: { select: { role: true } } },
    });
    if (row.asset?.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
      })
      .send(await readFile(assetPath(row.objectKey) + ".webp"));
  }
  @Get("files/:id/original") async original(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const row = await this.db.intakeFile.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: { asset: { select: { role: true } } },
    });
    if (row.asset?.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    res
      .set({
        "Content-Type": row.mime,
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      })
      .send(await readFile(assetPath(row.objectKey)));
  }
  @Post("batches/:id/assign") assign(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    uuid.parse(id);
    const b = z
      .object({
        entries: z
          .array(
            z
              .object({
                fileId: uuid,
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
                origin: z
                  .enum(["OWN", "SUPPLIER", "REFERENCE", "AI"])
                  .default("OWN"),
                sourceNote: safeText(2000).min(1),
              })
              .strict(),
          )
          .min(1)
          .max(25),
      })
      .strict()
      .parse(raw);
    if (new Set(b.entries.map((e) => e.fileId)).size !== b.entries.length)
      throw new Fault(
        "DUPLICATE_FILE",
        "一张图片不能在同一请求内分配两次",
        400,
      );
    for (const e of b.entries) {
      if (e.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
        throw new Fault("FORBIDDEN", "凭证归档需要财务权限", 403);
      if (
        ["AI", "REFERENCE"].includes(e.origin) &&
        !["REFERENCE", "AI_MARKETING"].includes(e.role)
      )
        throw new Fault("INVALID_ORIGIN", "参考或AI图不能冒充实物图", 400);
    }
    return this.commands.run(
      r.actor.id,
      "intake.assign",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "intake:" + id);
        const batch = await tx.intakeBatch.findUniqueOrThrow({ where: { id } });
        if (batch.state !== "OPEN")
          throw new Fault("BATCH_CLOSED", "批次已关闭");
        for (const itemId of [
          ...new Set(b.entries.map((e) => e.itemId)),
        ].sort())
          await itemLock(tx, itemId);
        const ids: string[] = [];
        for (const e of b.entries) {
          const f = await tx.intakeFile.findUnique({ where: { id: e.fileId } });
          if (!f || f.batchId !== id || f.state !== "UNASSIGNED")
            throw new Fault(
              "ASSIGNMENT_CONFLICT",
              "图片不在该批次、已归档或已忽略",
            );
          const a = await tx.asset.create({
            data: {
              itemId: e.itemId,
              objectKey: f.objectKey,
              originalName: f.originalName,
              sha256: f.sha256,
              mime: f.mime,
              size: f.size,
              role: e.role,
              origin: e.origin,
              sourceNote: e.sourceNote,
              rights: "INTERNAL",
              verified: false,
            },
          });
          await tx.intakeFile.update({
            where: { id: f.id },
            data: { assetId: a.id, state: "ASSIGNED", note: e.sourceNote },
          });
          await audit(tx, r.actor.id, "INTAKE_FILE_ASSIGNED", e.itemId, {
            fileId: f.id,
            assetId: a.id,
            batchId: id,
          });
          await event(tx, e.itemId);
          ids.push(a.id);
        }
        return { ids };
      },
    );
  }
  @Post("files/:id/ignore") ignore(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({ reason: safeText(1000).min(1) })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "intake.ignore",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const f = await tx.intakeFile.findUniqueOrThrow({ where: { id } });
        await lock(tx, "intake:" + f.batchId);
        const n = await tx.intakeFile.updateMany({
          where: { id, state: "UNASSIGNED" },
          data: { state: "IGNORED", note: b.reason },
        });
        if (n.count !== 1)
          throw new Fault("ASSIGNMENT_CONFLICT", "已归档图片不能从原批次忽略");
        await audit(tx, r.actor.id, "INTAKE_FILE_IGNORED", f.batchId, {
          fileId: id,
          reason: b.reason,
        });
        return { id };
      },
    );
  }
  @Post("batches/:id/close") close(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    return this.commands.run(
      r.actor.id,
      "intake.close",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id) },
      async (tx) => {
        await lock(tx, "intake:" + id);
        if (
          await tx.intakeFile.count({
            where: { batchId: id, state: "UNASSIGNED" },
          })
        )
          throw new Fault(
            "UNASSIGNED_FILES",
            "仍有未归属图片，请分配或记录忽略原因",
          );
        await tx.intakeBatch.update({
          where: { id },
          data: { state: "CLOSED" },
        });
        await audit(tx, r.actor.id, "INTAKE_CLOSED", id);
        return { id };
      },
    );
  }
}
