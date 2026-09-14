import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import {
  Commands,
  audit,
  event,
  hash,
  json,
  lock,
} from "../common/transaction";
import { Fault } from "../common/errors";
import { amount, currency, safeText, uuid } from "../common/domain";
import { itemLock } from "../catalog/catalog.service";
const sourceSchema = z
  .object({
    sourceKey: safeText(250).min(1),
    supplierId: uuid.optional(),
    title: safeText(300).min(1),
    payload: z.record(z.unknown()),
  })
  .strict();
@ApiTags("货源与供应商")
@Access("supply")
@Controller("api/supply")
export class SupplyController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Get("suppliers") suppliers() {
    return this.db.supplier.findMany({ orderBy: { createdAt: "desc" } });
  }
  @Post("suppliers") supplier(@Body() raw: unknown, @Req() r: AuthRequest) {
    const b = z
      .object({
        name: safeText(150).min(1),
        contact: safeText(500).default(""),
        notes: safeText(4000).default(""),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "supplier.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const row = await tx.supplier.create({ data: b });
        await audit(tx, r.actor.id, "SUPPLIER_CREATED", row.id);
        return { id: row.id };
      },
    );
  }
  @Get("sources") async sources(
    @Query("page") rawPage?: string,
    @Query("q") rawQuery = "",
    @Query("stage") rawStage = "",
  ) {
    const q = z.string().max(150).parse(rawQuery).trim(),
      stage = z.enum(["", "pending", "adopted"]).parse(rawStage);
    const include = {
      supplier: true,
      items: { select: { id: true, serial: true } },
      itemLinks: { include: { item: { select: { id: true, serial: true } } } },
      ingestCandidates: {
        take: 1,
        orderBy: { createdAt: "asc" as const },
        include: {
          procurementSource: { select: { name: true } },
          assets: {
            take: 1,
            orderBy: { createdAt: "asc" as const },
            select: { id: true },
          },
        },
      },
      purchaseLine: {
        select: {
          sourceSku: true,
          order: { select: { procurementSource: { select: { name: true } } } },
        },
      },
    };
    if (rawPage === undefined)
      return this.db.source.findMany({
        include,
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
    const page = z.coerce.number().int().min(1).max(100000).parse(rawPage);
    const where = {
      ...(stage === "pending"
        ? { AND: [{ items: { none: {} } }, { itemLinks: { none: {} } }] }
        : stage === "adopted"
          ? {
              AND: [
                { OR: [{ items: { some: {} } }, { itemLinks: { some: {} } }] },
              ],
            }
          : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { sourceKey: { contains: q, mode: "insensitive" as const } },
              {
                purchaseLine: {
                  sourceSku: { contains: q, mode: "insensitive" as const },
                },
              },
              {
                purchaseLine: {
                  order: {
                    procurementSource: {
                      name: { contains: q, mode: "insensitive" as const },
                    },
                  },
                },
              },
              {
                ingestCandidates: {
                  some: {
                    OR: [
                      {
                        sourceItemKey: {
                          contains: q,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        procurementSource: {
                          name: { contains: q, mode: "insensitive" as const },
                        },
                      },
                    ],
                  },
                },
              },
              {
                supplier: {
                  name: { contains: q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.source.count({ where }),
      this.db.source.findMany({
        where,
        include,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 50,
        skip: (page - 1) * 50,
      }),
    ]);
    return {
      total,
      rows: rows.map((row) => {
        const c = row.ingestCandidates[0];
        const payload = row.payload as Record<string, unknown>;
        return {
          ...row,
          items: [
            ...new Map(
              [...row.items, ...row.itemLinks.map((x) => x.item)].map((i) => [
                i.id,
                i,
              ]),
            ).values(),
          ],
          sourceLabel:
            c?.procurementSource.name ||
            row.purchaseLine?.order.procurementSource.name ||
            row.supplier?.name ||
            "手工货源",
          originalKey:
            c?.sourceItemKey ||
            row.purchaseLine?.sourceSku ||
            String(payload?.supplierCode || ""),
          previewUrl: c?.assets[0]
            ? `/api/ingest/candidate-assets/${c.assets[0].id}/preview`
            : null,
        };
      }),
      page,
      size: 50,
    };
  }
  @Get("sources/:id") source(@Param("id") id: string) {
    return this.db.source.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: {
        supplier: true,
        items: { select: { id: true, serial: true } },
      },
    });
  }
  @Get("sources/:id/revisions") revisions(@Param("id") id: string) {
    return this.db.sourceRevision.findMany({
      where: { sourceId: uuid.parse(id) },
      orderBy: { version: "desc" },
    });
  }
  @Post("sources/preview") async preview(@Body() raw: unknown) {
    const rows = z.array(sourceSchema).min(1).max(300).parse(raw);
    const keys = new Set<string>();
    return Promise.all(
      rows.map(async (b) => {
        const duplicate = keys.has(b.sourceKey);
        keys.add(b.sourceKey);
        const old = await this.db.source.findUnique({
          where: { sourceKey: b.sourceKey },
        });
        return {
          sourceKey: b.sourceKey,
          title: b.title,
          action: duplicate
            ? "DUPLICATE_IN_BATCH"
            : old
              ? hash(old.payload) === hash(b.payload) && old.title === b.title
                ? "UNCHANGED"
                : "NEW_REVISION"
              : "CREATE",
        };
      }),
    );
  }
  @Post("sources/import") importSources(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const rows = z.array(sourceSchema).min(1).max(300).parse(raw);
    if (new Set(rows.map((b) => b.sourceKey)).size !== rows.length)
      throw new Fault("DUPLICATE_SOURCE", "同一批次来源键重复", 400);
    return this.commands.run(
      r.actor.id,
      "source.import",
      r.get("Idempotency-Key"),
      rows,
      async (tx) => {
        const ids: string[] = [];
        // Deterministic order prevents two overlapping batches taking source locks in opposite order.
        for (const b of [...rows].sort((a, b) =>
          a.sourceKey.localeCompare(b.sourceKey),
        )) {
          await lock(tx, "sourceKey:" + b.sourceKey);
          const old = await tx.source.findUnique({
            where: { sourceKey: b.sourceKey },
          });
          if (old && old.supplierId !== (b.supplierId || null))
            throw new Fault("SOURCE_OWNER_CONFLICT", "来源键已属于不同供应商");
          if (
            old &&
            hash(old.payload) === hash(b.payload) &&
            old.title === b.title
          ) {
            ids.push(old.id);
            continue;
          }
          const row = old
            ? await tx.source.update({
                where: { id: old.id },
                data: {
                  title: b.title,
                  payload: json(b.payload),
                  version: { increment: 1 },
                },
              })
            : await tx.source.create({
                data: { ...b, payload: json(b.payload) },
              });
          await tx.sourceRevision.create({
            data: {
              sourceId: row.id,
              version: row.version,
              payload: json(b.payload),
            },
          });
          await audit(tx, r.actor.id, "SOURCE_IMPORTED", row.id, {
            version: row.version,
          });
          ids.push(row.id);
        }
        return { ids, count: ids.length };
      },
    );
  }
  @Post("offers") offer(@Body() raw: unknown, @Req() r: AuthRequest) {
    const b = z
      .object({
        itemId: uuid,
        supplierId: uuid,
        supplierCode: safeText(150).default(""),
        amount: amount.default(null),
        currency: currency.default("CNY"),
        validUntil: z.string().datetime(),
        canReserve: z.boolean().default(false),
        notes: safeText(2000).default(""),
      })
      .strict()
      .parse(raw);
    if (new Date(b.validUntil) <= new Date())
      throw new Fault("EXPIRED", "供货有效期必须在未来", 400);
    return this.commands.run(
      r.actor.id,
      "offer.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        await itemLock(tx, b.itemId);
        const row = await tx.offer.create({
          data: { ...b, validUntil: new Date(b.validUntil) },
        });
        await audit(tx, r.actor.id, "OFFER_CONFIRMED", b.itemId, {
          offerId: row.id,
        });
        await event(tx, b.itemId);
        return { id: row.id };
      },
    );
  }
  @Post("offers/:id/withdraw") async withdraw(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    const offer = await this.db.offer.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    return this.commands.run(
      r.actor.id,
      "offer.withdraw",
      r.get("Idempotency-Key"),
      { id },
      async (tx) => {
        await itemLock(tx, offer.itemId);
        await tx.offer.update({ where: { id }, data: { status: "WITHDRAWN" } });
        // Other live offers remain valid. A withdrawn offer is not proof the physical item was sold.
        await audit(tx, r.actor.id, "OFFER_WITHDRAWN", offer.itemId, {
          offerId: id,
        });
        await event(tx, offer.itemId, "SUPPLY_CHANGED");
        return { id };
      },
    );
  }
}
