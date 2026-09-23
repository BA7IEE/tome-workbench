import { ProcurementService } from "../procurement/procurement.service";
import { purchaseOrderImport } from "../procurement/procurement.schemas";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  Access,
  AuthRequest,
  IngestRequest,
  MachineIngest,
  permission,
} from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Fault } from "../common/errors";
import { safeText, uuid } from "../common/domain";
import { assetPath, prepareImage } from "../media/storage";
import { UploadBudget } from "../media/upload-budget";
import { IngestService } from "./ingest.service";
import {
  candidateBulkInput,
  candidateBulkExcludeInput,
  candidateConfirmInput,
  candidateLinkItemInput,
  candidateReviewInput,
  candidateBrandBindInput,
  ingestBatchInput,
  ingestCandidatesInput,
  ingestSessionInput,
} from "./ingest.schemas";

const sessionRevoke = z.object({ reason: safeText(1000).min(3) }).strict();
const assetMeta = z
  .object({
    sourceUrl: safeText(2000).default(""),
    roleHint: z
      .enum(["PRODUCT", "DETAIL", "DEFECT", "REFERENCE"])
      .default("PRODUCT"),
  })
  .strict();

@ApiTags("外部采集接入")
@Controller("api/ingest")
export class IngestAdminController {
  constructor(
    private db: PrismaService,
    private service: IngestService,
  ) {}
  @Access("dictionary") @Get("brand-governance/preview") brandPreview() {
    return this.service.brandGovernancePreview();
  }
  @Access("dictionary") @Post("brand-governance/bind") bindBrands(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.bindCandidateBrands(
      r.actor,
      r.get("Idempotency-Key"),
      candidateBrandBindInput.parse(raw),
    );
  }
  @Access("supply") @Post("sessions") createSession(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = ingestSessionInput.parse(raw);
    return this.service.createSession(r.actor, r.get("Idempotency-Key"), b);
  }
  @Access("supply") @Get("sessions") sessions() {
    return this.db.ingestSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        procurementSourceId: true,
        label: true,
        createdBy: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        procurementSource: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            defaultCurrency: true,
            active: true,
          },
        },
        _count: { select: { batches: true } },
      },
    });
  }
  @Access("supply") @Post("sessions/:id/revoke") revokeSession(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.revokeSession(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      sessionRevoke.parse(raw).reason,
    );
  }
  @Access("supply") @Get("batches") batches(
    @Query("sourceId") sourceId?: string,
  ) {
    return this.db.ingestBatch.findMany({
      where: sourceId ? { procurementSourceId: uuid.parse(sourceId) } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { candidates: true } } },
    });
  }
  @Access("supply") @Get("batches/:id/integrity") batchIntegrity(
    @Param("id") id: string,
  ) {
    return this.service.batchReport(this.db, uuid.parse(id));
  }
  @Access("read") @Get("batch-records") async batchRecords(
    @Query() raw: unknown,
  ) {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: safeText(150).default(""),
      })
      .strict()
      .parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.IngestBatchWhereInput = q.q
          ? {
              OR: [
                { externalBatchKey: { contains: q.q, mode: "insensitive" } },
                {
                  procurementSource: {
                    name: { contains: q.q, mode: "insensitive" },
                  },
                },
              ],
            }
          : {};
        const total = await tx.ingestBatch.count({ where });
        const page = Math.min(q.page, Math.max(1, Math.ceil(total / 30)));
        const rows = await tx.ingestBatch.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 30,
          skip: (page - 1) * 30,
          select: {
            id: true,
            externalBatchKey: true,
            status: true,
            createdAt: true,
            agentName: true,
            procurementSource: { select: { name: true } },
            _count: { select: { members: true } },
          },
        });
        const counts = rows.length
          ? await tx.$queryRaw<
              { batchId: string; decision: string; count: number }[]
            >(Prisma.sql`
        SELECT m."batchId", c."decision", count(*)::int AS count FROM "IngestBatchMember" m
        JOIN "IngestCandidate" c ON c.id=m."candidateId"
        WHERE m."batchId" IN (${Prisma.join(rows.map((b) => Prisma.sql`${b.id}::uuid`))})
        GROUP BY m."batchId", c."decision"`)
          : [];
        return {
          total,
          page,
          rows: rows.map((b) => ({
            ...b,
            counts: Object.fromEntries(
              counts
                .filter((c) => c.batchId === b.id)
                .map((c) => [c.decision, c.count]),
            ),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("read") @Get("items/:id/evidence") async itemEvidence(
    @Param("id") id: string,
  ) {
    const item = await this.db.item.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    if (item.deletedAt || item.dataMode !== "BUSINESS") return [];
    return this.db.ingestCandidate.findMany({
      where: { itemId: item.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        titleRaw: true,
        sourceItemKey: true,
        procurementSource: { select: { name: true } },
      },
    });
  }
  @Access("read") @Get("candidates") async candidates(@Query() raw: unknown) {
    const b = z
      .object({
        q: safeText(150).default(""),
        decision: z
          .enum(["", "PENDING", "CONFIRMED", "EXCLUDED"])
          .default("PENDING"),
        sourceId: z.union([uuid, z.literal("")]).default(""),
        batchId: z.union([uuid, z.literal("")]).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        size: z.coerce.number().int().min(20).max(100).default(100),
      })
      .strict()
      .parse(raw);
    const where: Prisma.IngestCandidateWhereInput = {
      ...(b.decision ? { decision: b.decision } : {}),
      ...(b.sourceId ? { procurementSourceId: b.sourceId } : {}),
      ...(b.batchId ? { memberships: { some: { batchId: b.batchId } } } : {}),
      ...(b.q
        ? {
            OR: [
              { titleRaw: { contains: b.q, mode: "insensitive" } },
              { brandRaw: { contains: b.q, mode: "insensitive" } },
              { sourceItemKey: { contains: b.q, mode: "insensitive" } },
              { externalKey: { contains: b.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.ingestCandidate.count({ where }),
      this.db.ingestCandidate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: b.size,
        skip: (b.page - 1) * b.size,
        include: {
          procurementSource: true,
          batch: true,
          item: { select: { id: true, serial: true, title: true } },
          assets: {
            where: { retiredAt: null },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    ]);
    const pendingIds = rows
        .filter((row) => row.decision === "PENDING")
        .map((row) => row.id),
      candidateAssets = pendingIds.length
        ? await this.db.ingestCandidateAsset.findMany({
            where: { candidateId: { in: pendingIds }, retiredAt: null },
            select: { candidateId: true, sha256: true },
          })
        : [],
      shas = [...new Set(candidateAssets.map((asset) => asset.sha256))],
      existing = shas.length
        ? await this.db.asset.findMany({
            where: {
              sha256: { in: shas },
              item: { deletedAt: null, dataMode: "BUSINESS" },
            },
            select: { sha256: true, itemId: true },
          })
        : [];
    const itemIdsBySha = new Map<string, Set<string>>(),
      shasByCandidate = new Map<string, Set<string>>();
    for (const asset of candidateAssets) {
      const values =
        shasByCandidate.get(asset.candidateId) ?? new Set<string>();
      values.add(asset.sha256);
      shasByCandidate.set(asset.candidateId, values);
    }
    for (const asset of existing) {
      const ids = itemIdsBySha.get(asset.sha256) ?? new Set<string>();
      ids.add(asset.itemId);
      itemIdsBySha.set(asset.sha256, ids);
    }
    return {
      total,
      page: b.page,
      size: b.size,
      rows: await Promise.all(
        rows.map(async (row) => {
          const ids = new Set<string>();
          if (row.decision === "PENDING")
            for (const sha of shasByCandidate.get(row.id) ?? [])
              for (const itemId of itemIdsBySha.get(sha) ?? []) ids.add(itemId);
          return {
            ...row,
            integrity: await this.service.captureReport(row),
            possibleDuplicateCount: ids.size,
          };
        }),
      ),
    };
  }
  @Access("read") @Get("candidates/:id") async candidate(
    @Param("id") id: string,
  ) {
    const row = await this.db.ingestCandidate.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: {
        procurementSource: true,
        batch: true,
        item: { select: { id: true, serial: true, title: true, status: true } },
        source: true,
        purchaseLine: {
          include: { order: { include: { adjustments: true } } },
        },
        assets: { orderBy: { createdAt: "asc" } },
        revisions: { orderBy: { version: "desc" }, take: 10 },
      },
    });
    const assets = row.assets.filter((asset) => !asset.retiredAt);
    const retiredAssets = row.assets.filter((asset) => !!asset.retiredAt);
    return {
      ...row,
      assets,
      retiredAssets,
      integrity: await this.service.captureReport({ ...row, assets }),
    };
  }
  @Access("read") @Get("candidate-assets/:id/preview") async candidatePreview(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const a = await this.readableCandidateAsset(id, r);
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(await readFile(assetPath(a.objectKey) + ".webp"));
  }
  private async readableCandidateAsset(id: string, r: AuthRequest) {
    const a = await this.db.ingestCandidateAsset.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: { asset: true },
    });
    if (a.asset?.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    return a;
  }
  @Access("read") @Get("candidate-assets/:id/original") async candidateOriginal(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
  ) {
    const a = await this.readableCandidateAsset(id, r);
    res
      .set({
        "Content-Type": a.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${a.id}.${a.mime.split("/")[1]}"`,
      })
      .send(await readFile(assetPath(a.objectKey)));
  }
  @Access("read") @Get("candidates/:id/matches") matches(
    @Param("id") id: string,
  ) {
    return this.service.candidateMatches(uuid.parse(id));
  }
  @Access("edit") @Post("candidates/:id/link-item") linkItem(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.linkCandidateToItem(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      candidateLinkItemInput.parse(raw),
    );
  }
  @Access("edit") @Post("candidates/:id/review") review(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.reviewCandidate(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      candidateReviewInput.parse(raw),
    );
  }
  @Access("edit") @Post("candidates/:id/confirm") confirm(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.confirmCandidate(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      candidateConfirmInput.parse(raw),
    );
  }
  @Access("edit") @Post("candidates/bulk-confirm") async bulkConfirm(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = candidateBulkInput.parse(raw),
      outer = r.get("Idempotency-Key");
    if (typeof outer !== "string" || outer.length < 12)
      throw new Fault("IDEMPOTENCY_REQUIRED", "批量确认需要幂等键", 400);
    const rows = [] as Record<string, unknown>[];
    for (let n = 0; n < b.ids.length; n++) {
      const id = b.ids[n],
        c = await this.db.ingestCandidate.findUnique({
          where: { id },
          select: { version: true },
        });
      if (!c) {
        rows.push({ id, ok: false, error: "候选不存在" });
        continue;
      }
      try {
        const result = await this.service.confirmCandidate(
          r.actor,
          `${outer}.${n}.${id.slice(0, 8)}`,
          id,
          {
            version: b.versions?.[id] ?? c.version,
            possession: b.possession,
            status: b.status,
            acceptIncomplete: !!b.incompleteAcknowledgements?.[id],
            note: b.incompleteAcknowledgements?.[id] || "批量确认导入",
          },
        );
        rows.push({ ok: true, ...result });
      } catch (e) {
        rows.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return {
      rows,
      ok: rows.filter((x) => x.ok).length,
      failed: rows.filter((x) => !x.ok).length,
    };
  }
  @Access("edit") @Post("candidates/bulk-exclude") async bulkExclude(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = candidateBulkExcludeInput.parse(raw),
      outer = r.get("Idempotency-Key");
    if (typeof outer !== "string" || outer.length < 12)
      throw new Fault("IDEMPOTENCY_REQUIRED", "批量排除需要幂等键", 400);
    const rows: Record<string, unknown>[] = [];
    for (let n = 0; n < b.ids.length; n++) {
      const id = b.ids[n],
        c = await this.db.ingestCandidate.findUnique({
          where: { id },
          select: { version: true, possession: true },
        });
      if (!c) {
        rows.push({ id, ok: false, error: "候选不存在" });
        continue;
      }
      try {
        const result = await this.service.reviewCandidate(
          r.actor,
          `${outer}.${n}.${id.slice(0, 8)}`,
          id,
          {
            version: b.versions?.[id] ?? c.version,
            possession: c.possession as "UNKNOWN" | "IN_HAND" | "NOT_IN_HAND",
            decision: "EXCLUDED",
            note: b.reason,
          },
        );
        rows.push({ ok: true, ...result });
      } catch (e) {
        rows.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return {
      rows,
      ok: rows.filter((x) => x.ok).length,
      failed: rows.filter((x) => !x.ok).length,
    };
  }
}

@ApiTags("Agent导入协议")
@MachineIngest()
@Controller("api/agent-ingest")
export class IngestMachineController {
  constructor(
    private service: IngestService,
    private procurement: ProcurementService,
  ) {}
  @Get("protocol") protocol(@Req() r: IngestRequest) {
    return this.service.machineProtocol(r.ingestSession);
  }
  @Get("skill") async skill(@Res() res: Response) {
    const skill = await this.service.machineSkillDocument();
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(skill.markdown);
  }
  @Get("profile") async profile(@Req() r: IngestRequest, @Res() res: Response) {
    const profile = await this.service.machineProfileDocument(r.ingestSession);
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(profile.markdown);
  }
  @Post("orders")
  order(@Body() raw: unknown, @Req() r: IngestRequest) {
    const b = purchaseOrderImport.parse(raw);
    if (b.procurementSourceId !== r.ingestSession.procurementSourceId)
      throw new Fault("INGEST_SOURCE_SCOPE", "订单来源不属于当前导入会话", 403);
    return this.service.machineRun(
      r.ingestSession,
      "order.import",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const result = await this.procurement.importInTx(tx, b);
        return { ...result };
      },
    );
  }
  @Post("batches") createBatch(@Body() raw: unknown, @Req() r: IngestRequest) {
    return this.service.createMachineBatch(
      r.ingestSession,
      r.get("Idempotency-Key"),
      ingestBatchInput.parse(raw),
    );
  }
  @Post("batches/:id/candidates") candidates(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: IngestRequest,
  ) {
    const b = ingestCandidatesInput.parse(raw);
    return this.service.upsertMachineCandidates(
      r.ingestSession,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      b.candidates,
    );
  }
  @Post("batches/:id/seal") seal(
    @Param("id") id: string,
    @Req() r: IngestRequest,
  ) {
    return this.service.sealMachineBatch(
      r.ingestSession,
      r.get("Idempotency-Key"),
      uuid.parse(id),
    );
  }
  @Get("batches/:id") status(@Param("id") id: string, @Req() r: IngestRequest) {
    return this.service.machineBatchStatus(r.ingestSession, uuid.parse(id));
  }
  @Post("candidates/:id/assets")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    UploadBudget,
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4 },
    }),
  )
  async asset(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() raw: unknown,
    @Req() r: IngestRequest,
  ) {
    const candidateId = uuid.parse(id),
      meta = assetMeta.parse(raw),
      prepared = await prepareImage(file);
    return this.service.registerCandidateAsset(
      r.ingestSession,
      r.get("Idempotency-Key"),
      candidateId,
      prepared,
      meta,
    );
  }
}
