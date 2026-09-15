import { approveRevision } from "./approve-revision";
import {
  selectionSchema,
  normalizeTerm,
} from "../dictionaries/dictionary-rules";
import {
  resolveItemDictionaries,
  saveItemDictionaries,
  dictionaryIds,
} from "../dictionaries/item-dictionaries";
import type { CatalogFilters } from "./catalog-query";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Actor, permission } from "../auth/auth";
import {
  Commands,
  Tx,
  audit,
  event,
  hash,
  json,
  lock,
} from "../common/transaction";
import { Fault } from "../common/errors";
import {
  amount,
  currency,
  expectedVersion,
  factsPatch,
  factsSchema,
  tm,
  safeText,
  uuid,
} from "../common/domain";
export const newItem = z
  .object({
    title: safeText(300).min(1),
    brand: safeText(100).default(""),
    dictionary: selectionSchema.optional(),
    category: z
      .enum(["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"])
      .default("CLOTHING"),
    ownership: z.enum(["OWN", "SUPPLIER"]).default("OWN"),
    location: safeText(300).default(""),
    sourceId: uuid.optional(),
    dataMode: z.enum(["BUSINESS", "TEST"]).default("BUSINESS"),
    facts: factsSchema.default({}),
    currentPrice: amount.optional(),
    currency: currency.default("CNY"),
  })
  .strict();
export const patchItem = newItem
  .omit({ sourceId: true, location: true, dataMode: true })
  .partial()
  .extend({ version: expectedVersion, facts: factsPatch.optional() })
  .strict();
export async function snapshot(
  tx: Tx,
  item: {
    id: string;
    title: string;
    brand: string;
    category: string;
    facts: Prisma.JsonValue;
  },
) {
  return {
    dictionary: await tx.itemDictionarySelection.findMany({
      where: { itemId: item.id },
      orderBy: { kind: "asc" },
      select: {
        kind: true,
        entryId: true,
        entryVersion: true,
        code: true,
        label: true,
        labelEn: true,
        description: true,
      },
    }),
    title: item.title,
    brand: item.brand,
    category: item.category,
    facts: item.facts,
  };
}
export async function getItem(tx: Tx, id: string, includeDeleted = false) {
  const item = await tx.item.findUnique({ where: { id } });
  if (!item) throw new Fault("NOT_FOUND", "商品不存在", 404);
  if (item.deletedAt && !includeDeleted)
    throw new Fault("ITEM_DELETED", "商品已在回收站，请先恢复后再操作");
  return item;
}
export async function itemLock(tx: Tx, id: string, includeDeleted = false) {
  await lock(tx, "item:" + id);
  return getItem(tx, id, includeDeleted);
}
export function versionMatch(current: number, expected: number) {
  if (current !== expected)
    throw new Fault("VERSION_CONFLICT", "资料已被其他人修改，请刷新后重新合并");
}
export type NewItemInput = z.infer<typeof newItem>;
export async function createItemInTx(tx: Tx, actor: Actor, b: NewItemInput) {
  if (
    b.dataMode === "TEST" &&
    (
      await tx.user.findUnique({
        where: { id: actor.id },
        select: { role: true },
      })
    )?.role !== "ADMIN"
  )
    throw new Fault("FORBIDDEN", "创建测试商品需要管理员权限", 403);
  let purchaseLineId: string | null = null;
  if (b.sourceId) {
    await lock(tx, "source:" + b.sourceId);
    const source = await tx.source.findUnique({
      where: { id: b.sourceId },
      select: { purchaseLineId: true },
    });
    if (!source) throw new Fault("SOURCE_NOT_FOUND", "货源不存在或已删除", 404);
    purchaseLineId = source.purchaseLineId;
    const old = await tx.item.findUnique({
      where: { sourceId: b.sourceId },
    });
    if (old?.deletedAt)
      throw new Fault(
        "SOURCE_ITEM_DELETED",
        "此货源的商品已在回收站，请恢复原商品，不要重复建档",
      );
    if (old) return { id: old.id, code: tm(old.serial), existing: true };
  }
  const { dictionary, ...values } = b;
  const resolved = await resolveItemDictionaries(
    tx,
    { brand: b.brand, category: b.category, facts: b.facts },
    dictionary,
  );
  const item = await tx.item.create({
    data: {
      ...values,
      ...(b.dataMode === "TEST"
        ? {
            testMarkedAt: new Date(),
            testMarkedBy: actor.id,
            testReason: "管理员在建档时明确选择测试商品",
          }
        : {}),
      brand: resolved.brand,
      facts: json(resolved.facts),
    },
  });
  await saveItemDictionaries(tx, item.id, resolved.selections);
  if (b.sourceId) {
    await tx.itemSourceLink.upsert({
      where: { itemId_sourceId: { itemId: item.id, sourceId: b.sourceId } },
      create: {
        itemId: item.id,
        sourceId: b.sourceId,
        linkedBy: actor.id,
        note: "TM建档首个来源",
      },
      update: {},
    });
  }
  await tx.cycle.create({
    data: { itemId: item.id, number: 1, cooperation: "INCLUDED" },
  });
  await tx.itemRevision.create({
    data: {
      itemId: item.id,
      version: 1,
      snapshot: json(await snapshot(tx, item)),
    },
  });
  if (purchaseLineId) {
    await lock(tx, "purchase-line:" + purchaseLineId);
    const linked = await tx.itemPurchaseLink.findUnique({
      where: { purchaseLineId },
    });
    if (linked && linked.itemId !== item.id)
      throw new Fault(
        "PURCHASE_LINE_ALREADY_LINKED",
        "该采购订单行已关联另一件TM商品",
        409,
      );
    if (!linked)
      await tx.itemPurchaseLink.create({
        data: {
          purchaseLineId,
          itemId: item.id,
          linkedBy: actor.id,
          note: "由采购货源候选建档自动关联",
        },
      });
  }
  await audit(tx, actor.id, "ITEM_CREATED", item.id, {
    sourceId: b.sourceId || null,
    cooperation: "INCLUDED",
  });
  return { id: item.id, code: tm(item.serial) };
}

@Injectable()
export class CatalogService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  async list(
    q = "",
    status = "",
    page = 1,
    filters: CatalogFilters = {},
    actor?: Actor,
  ) {
    const query = q.trim().slice(0, 100),
      serial = /^TM\d{6,}$/i.test(query) ? Number(query.slice(2)) : undefined;
    const where: Prisma.ItemWhereInput = {
      deletedAt: null,
      ...(filters.dataMode === "ALL"
        ? {}
        : { dataMode: filters.dataMode || "BUSINESS" }),
      AND: Object.entries({
        BRAND: filters.brandId,
        CONDITION: filters.conditionId,
        COLOR: filters.colorId,
        MATERIAL: filters.materialId,
      })
        .filter(([, id]) => !!id)
        .map(([kind, entryId]) => ({
          dictionarySelections: { some: { kind, entryId } },
        })),
      ...(status ? { status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.ownership ? { ownership: filters.ownership } : {}),
      ...(filters.location
        ? { location: { contains: filters.location, mode: "insensitive" } }
        : {}),
      ...(filters.sizeLabel
        ? {
            facts: {
              path: ["sizeLabel"],
              string_contains: filters.sizeLabel,
              mode: "insensitive",
            },
          }
        : {}),
      ...(filters.review
        ? { approvedValid: filters.review === "approved" }
        : {}),
      ...(filters.listing === "none"
        ? { listings: { none: {} } }
        : filters.listing === "recorded"
          ? { listings: { some: {} } }
          : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { brand: { contains: query, mode: "insensitive" } },
              {
                dictionarySelections: {
                  some: {
                    kind: "BRAND",
                    entry: {
                      terms: {
                        some: {
                          normalized: { contains: normalizeTerm(query) },
                        },
                      },
                    },
                  },
                },
              },
              {
                aliases: { some: { code: { contains: query.toUpperCase() } } },
              },
              ...(serial && Number.isSafeInteger(serial) ? [{ serial }] : []),
            ],
          }
        : {}),
    };
    const extra: Prisma.ItemWhereInput[] = [];
    if (filters.missing === "images")
      extra.push({
        assets: {
          none: {
            archived: false,
            role: { in: ["PRODUCT", "DETAIL", "DEFECT", "REFERENCE"] },
          },
        },
      });
    if (filters.missing === "price") extra.push({ currentPrice: null });
    if (filters.missing === "size" || filters.missing === "description") {
      const path = [filters.missing === "size" ? "sizeLabel" : "descriptionZh"];
      extra.push({
        OR: [
          { facts: { path, equals: "" } },
          { facts: { path, equals: Prisma.AnyNull } },
        ],
      });
    }
    // Source and keyword predicates are independent; neither may replace the other.
    if (filters.source)
      extra.push({
        OR: [
          {
            ingestCandidates: {
              some: {
                procurementSource: {
                  name: { contains: filters.source, mode: "insensitive" },
                },
              },
            },
          },
          {
            sourceLinks: {
              some: {
                source: {
                  OR: [
                    {
                      sourceKey: {
                        contains: filters.source,
                        mode: "insensitive",
                      },
                    },
                    {
                      supplier: {
                        name: { contains: filters.source, mode: "insensitive" },
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            facts: {
              path: ["attributes", "sourcePlatform"],
              string_contains: filters.source,
              mode: "insensitive",
            },
          },
        ],
      });
    where.AND = [...(where.AND as Prisma.ItemWhereInput[]), ...extra];
    const size = filters.size || 30;
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.item.count({ where });
        const resolvedPage = Math.min(
          page,
          Math.max(1, Math.ceil(total / size)),
        );
        const orderBy: Prisma.ItemOrderByWithRelationInput[] =
          filters.sort === "oldest"
            ? [{ serial: "asc" }]
            : filters.sort === "updated"
              ? [{ updatedAt: "desc" }, { serial: "desc" }]
              : [{ serial: "desc" }];
        const rows = await tx.item.findMany({
          where,
          orderBy,
          skip: (resolvedPage - 1) * size,
          take: size,
          include: {
            dictionarySelections: true,
            costEntries: {
              where: { status: "ACTIVE", confirmed: true, currency: "CNY" },
              select: { amount: true },
            },
            assets: {
              // Internal recognition includes source reference photos. This read
              // projection does not grant publishing rights or verification.
              where: {
                archived: false,
                role: { in: ["PRODUCT", "DETAIL", "REFERENCE"] },
              },
              orderBy: [
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" },
              ],
              take: 1,
            },
            _count: {
              select: {
                listings: true,
                assets: {
                  where: {
                    archived: false,
                    role: { in: ["PRODUCT", "DETAIL", "DEFECT", "REFERENCE"] },
                  },
                },
              },
            },
          },
        });
        return {
          total,
          page: resolvedPage,
          size,
          rows: rows.map((r) => {
            const { costEntries, ...safe } = r;
            return {
              ...safe,
              dictionary: dictionaryIds(r.dictionarySelections),
              code: tm(r.serial),
              ...(actor && permission(actor.role, "finance")
                ? {
                    currentCostCny: costEntries.length
                      ? costEntries.reduce((n, c) => n + c.amount, 0)
                      : null,
                  }
                : {}),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(id: string, actor: Actor) {
    const item = await this.db.item.findUnique({
      where: { id },
      include: {
        dictionarySelections: true,
        aliases: true,
        waivers: { orderBy: { createdAt: "desc" } },
        assets: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
        offers: permission(actor.role, "supply")
          ? { include: { supplier: true } }
          : false,
        revisions: { orderBy: { version: "desc" }, take: 20 },
        tasks: { orderBy: { createdAt: "desc" } },
        listings: { include: { channel: true } },
        packages: {
          include: { channel: true },
          orderBy: { createdAt: "desc" },
          take: 30,
        },
        movements: { orderBy: { occurredAt: "desc" }, take: 30 },
        observations: { orderBy: { createdAt: "desc" }, take: 20 },
        suggestions: { orderBy: { createdAt: "desc" }, take: 20 },
        reservations: { where: { status: "ACTIVE" } },
      },
    });
    if (!item) throw new Fault("NOT_FOUND", "商品不存在", 404);
    const intents = permission(actor.role, "finance")
      ? await this.db.exceptionIntent.findMany({
          where: { itemId: id },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const currentCostCny = permission(actor.role, "finance")
      ? (
          await this.db.costEntry.aggregate({
            where: {
              itemId: id,
              status: "ACTIVE",
              confirmed: true,
              currency: "CNY",
            },
            _sum: { amount: true },
          })
        )._sum.amount
      : undefined;
    return {
      ...item,
      ...(currentCostCny !== undefined ? { currentCostCny } : {}),
      dictionary: dictionaryIds(item.dictionarySelections),
      assets: item.assets.filter(
        (a) => a.role !== "DOCUMENT" || permission(actor.role, "finance"),
      ),
      observations: permission(actor.role, "sell") ? item.observations : [],
      reservations: permission(actor.role, "sell") ? item.reservations : [],
      movements: permission(actor.role, "edit") ? item.movements : [],
      code: tm(item.serial),
      intents,
    };
  }
  create(actor: Actor, key: unknown, raw: unknown) {
    const b = newItem.parse(raw);
    if (b.dataMode === "TEST" && actor.role !== "ADMIN")
      throw new Fault("FORBIDDEN", "创建测试商品需要管理员权限", 403);
    if (
      (b.facts.authentication.status !== "UNKNOWN" ||
        b.facts.research.some((r) => r.confirmed)) &&
      !permission(actor.role, "review")
    )
      throw new Fault(
        "REVIEW_REQUIRED",
        "只有复核人员可以确认真实性和研究依据",
        403,
      );
    return this.commands.run(actor.id, "item.create", key, b, (tx) =>
      createItemInTx(tx, actor, b),
    );
  }
  update(actor: Actor, id: string, key: unknown, raw: unknown) {
    const b = patchItem.parse(raw);
    return this.commands.run(
      actor.id,
      "item.update",
      key,
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        versionMatch(item.version, b.version);
        const previous = factsSchema.parse(item.facts);
        if (b.facts?.authentication && !permission(actor.role, "review"))
          throw new Fault("REVIEW_REQUIRED", "真实性复核需要复核权限", 403);
        if (
          b.facts?.research?.some((r) => r.confirmed) &&
          !permission(actor.role, "review")
        )
          throw new Fault("REVIEW_REQUIRED", "确认研究依据需要复核权限", 403);
        if (b.ownership && b.ownership !== item.ownership)
          throw new Fault(
            "OWNERSHIP_IMMUTABLE",
            "本版不允许直接改所有权模式；请保留记录并联系管理员核对",
          );
        const resolved = await resolveItemDictionaries(
          tx,
          {
            brand: b.brand ?? item.brand,
            category: b.category ?? item.category,
            facts: factsSchema.parse({ ...previous, ...b.facts }),
          },
          b.dictionary,
          id,
        );
        const next = resolved.facts;
        const critical =
          resolved.selectionChanged ||
          resolved.brand !== item.brand ||
          (b.category !== undefined && b.category !== item.category) ||
          (
            [
              "conditionGrade",
              "conditionGradeEn",
              "mainMaterial",
              "material",
              "condition",
              "measurements",
              "sizeLabel",
              "authentication",
              "research",
              "attributes",
              "attributeLabels",
            ] as const
          ).some((k) => hash(previous[k]) !== hash(next[k]));
        const {
          version: _version,
          facts: _facts,
          dictionary: _dictionary,
          ...rest
        } = b;
        void _dictionary;
        void _version;
        void _facts;
        const updated = await tx.item.update({
          where: { id },
          data: {
            ...rest,
            brand: resolved.brand,
            facts: json(next),
            version: { increment: 1 },
            ...(critical ? { approvedValid: false } : {}),
          },
        });
        await saveItemDictionaries(tx, id, resolved.selections);
        await tx.itemRevision.create({
          data: {
            itemId: id,
            version: updated.version,
            snapshot: json(await snapshot(tx, updated)),
          },
        });
        await audit(tx, actor.id, "ITEM_UPDATED", id, {
          keys: Object.keys(b),
          version: updated.version,
          critical,
        });
        await event(tx, id, critical ? "CONTENT_REVIEW" : "ITEM_CHANGED");
        return { id, version: updated.version };
      },
    );
  }
  approve(actor: Actor, id: string, key: unknown, raw: unknown) {
    const b = z.object({ version: expectedVersion }).strict().parse(raw);
    return this.commands.run(
      actor.id,
      "item.approve",
      key,
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        versionMatch(item.version, b.version);
        return approveRevision(tx, item, actor.id);
      },
    );
  }
  move(actor: Actor, id: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        version: expectedVersion,
        to: safeText(300).min(1),
        evidence: safeText(1500).min(1),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "item.move",
      key,
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        versionMatch(item.version, b.version);
        await tx.movement.create({
          data: {
            itemId: id,
            from: item.location,
            to: b.to,
            evidence: b.evidence,
            createdBy: actor.id,
          },
        });
        const moved = await tx.item.update({
          where: { id },
          data: { location: b.to, version: { increment: 1 } },
        });
        await tx.itemRevision.create({
          data: {
            itemId: id,
            version: moved.version,
            snapshot: json(await snapshot(tx, moved)),
          },
        });
        await audit(tx, actor.id, "CUSTODY_MOVED", id);
        return { id };
      },
    );
  }
}
