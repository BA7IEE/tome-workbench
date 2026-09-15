import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Response } from "express";
import archiver from "archiver";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  Access,
  AuthRequest,
  permission,
  type Actor,
  type Role,
} from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, hash, json, type Tx } from "../common/transaction";
import { Fault } from "../common/errors";
import { safeText, uuid, tm } from "../common/domain";
import { itemLock, versionMatch } from "./catalog.service";
import { assetPath } from "../media/storage";
import { record } from "../ingest/ingest-integrity";

const input = z
  .object({
    title: safeText(160).min(1).default("商品资料"),
    scope: z.enum(["OPERATIONS", "INTERNAL"]).default("OPERATIONS"),
    dataMode: z.enum(["BUSINESS", "TEST"]).default("BUSINESS"),
    items: z
      .array(
        z.object({ id: uuid, version: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.id)).size === v.items.length,
    "商品不能重复",
  );
const include = {
  assets: {
    where: { archived: false },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
  costEntries: {
    where: { status: "ACTIVE", confirmed: true, currency: "CNY" },
    select: { amount: true },
  },
  sourceLinks: { include: { source: true } },
  aliases: { select: { code: true } },
} satisfies Prisma.ItemInclude;
type Product = Prisma.ItemGetPayload<{ include: typeof include }>;
type Picture = {
  id: string;
  originalName: string;
  sha256: string;
  mime: string;
  size: number;
  role: string;
  rights: string;
  origin: string;
  verified: boolean;
  validUntil: string | null;
  path: string;
};
type Material = {
  id: string;
  code: string;
  title: string;
  brand: string;
  category: string;
  status: string;
  version: number;
  currency: string;
  priceMinor: number | null;
  facts: Record<string, unknown>;
  images: Picture[];
  aliases: string[];
  costCnyMinor?: number | null;
  location?: string;
  sources?: unknown;
  dataMode: string;
};
const categoryNames: Record<string, string> = {
  CLOTHING: "服装",
  BAG: "包袋",
  SHOES: "鞋履",
  ACCESSORY: "配饰",
  OTHER: "其他",
};
const statusNames: Record<string, string> = {
  AVAILABLE: "可售",
  PAUSED: "已暂停",
  RESERVED: "已预留",
  SOLD: "我方已售",
  SUPPLIER_SOLD: "供货方已售",
  GIFTED: "已赠出",
  SELF_USE: "自留",
  QUARANTINED: "退回待复检",
};
export const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function materialCsv(rows: Material[], internal: boolean) {
  const heads = [
    "商品编号",
    "名称",
    "品牌",
    "品类",
    "库存状态",
    "售价币种",
    "售价（元）",
    "尺码",
    "本地成色",
    "来源成色",
    "瑕疵说明",
    "材质",
    "颜色",
    "尺寸",
    "中文介绍",
    "英文介绍",
    "原图文件",
  ];
  if (internal) heads.push("人民币成本（元）", "实物位置");
  return (
    "\uFEFF" +
    [
      heads,
      ...rows.map((r) => {
        const f = r.facts,
          a = record(f.attributes);
        const row: unknown[] = [
          r.code,
          r.title,
          r.brand || a.sourceBrand,
          categoryNames[r.category],
          statusNames[r.status],
          r.currency,
          r.priceMinor === null ? "" : (r.priceMinor / 100).toFixed(2),
          f.sizeLabel,
          f.conditionGrade,
          a.sourceCondition,
          f.condition || a.sourceConditionDetailsZh || a.sourceConditionDetails,
          f.material,
          f.color,
          f.measurements,
          f.descriptionZh,
          f.descriptionEn,
          r.images.map((i) => i.path).join(" | "),
        ];
        if (internal)
          row.push(
            r.costCnyMinor == null ? "" : (r.costCnyMinor / 100).toFixed(2),
            r.location,
          );
        return row;
      }),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
function material(item: Product, scope: string): Material {
  const original = record(item.facts),
    attrs = record(original.attributes),
    facts: Record<string, unknown> = {};
  for (const k of [
    "sizeLabel",
    "conditionGrade",
    "conditionGradeEn",
    "condition",
    "mainMaterial",
    "material",
    "color",
    "measurements",
    "descriptionZh",
    "descriptionEn",
  ])
    if (original[k] !== undefined) facts[k] = original[k];
  facts.attributes = Object.fromEntries(
    [
      "sourceBrand",
      "sourceCondition",
      "sourceConditionDetails",
      "sourceConditionDetailsZh",
      "sourceColor",
      "sourceSize",
    ]
      .filter((k) => attrs[k] !== undefined)
      .map((k) => [k, attrs[k]]),
  );
  const code = tm(item.serial);
  const images = item.assets
    .filter(
      (a) =>
        scope === "INTERNAL" ||
        (a.role !== "DOCUMENT" && a.role !== "AI_MARKETING"),
    )
    .map((a, n) => ({
      id: a.id,
      originalName: a.originalName,
      sha256: a.sha256,
      mime: a.mime,
      size: a.size,
      role: a.role,
      rights: a.rights,
      origin: a.origin,
      verified: a.verified,
      validUntil: a.validUntil?.toISOString() ?? null,
      path: `商品/${code}/${String(n + 1).padStart(2, "0")}-${a.originalName.replace(/[^\p{L}\p{N}._ -]/gu, "_") || "原图"}`,
    }));
  return {
    id: item.id,
    code,
    title: item.title,
    brand: item.brand,
    category: item.category,
    status: item.status,
    version: item.version,
    currency: item.currency,
    priceMinor: item.currentPrice,
    facts: scope === "INTERNAL" ? original : facts,
    images,
    aliases: item.aliases.map((a) => a.code),
    dataMode: item.dataMode,
    ...(scope === "INTERNAL"
      ? {
          costCnyMinor: item.costEntries.length
            ? item.costEntries.reduce((n, c) => n + c.amount, 0)
            : null,
          location: item.location,
          sources: item.sourceLinks.map((l) => ({
            id: l.source.id,
            key: l.source.sourceKey,
            title: l.source.title,
            version: l.source.version,
            payload: l.source.payload,
          })),
        }
      : {}),
  };
}
function differences(before: Material, after: Material) {
  const fields: [keyof Material, string][] = [
    ["status", "库存状态"],
    ["priceMinor", "售价"],
    ["currency", "售价币种"],
    ["title", "名称"],
    ["brand", "品牌"],
    ["category", "品类"],
    ["facts", "商品资料"],
    ["images", "图片"],
    ["costCnyMinor", "人民币成本"],
    ["location", "实物位置"],
    ["sources", "来源资料"],
    ["aliases", "旧编号"],
  ];
  return fields
    .filter(([k]) => hash(before[k] ?? null) !== hash(after[k] ?? null))
    .map(([, name]) => name);
}
@ApiTags("商品资料包")
@Controller("api/material-exports")
export class MaterialsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  private async checkScope(
    tx: Tx | PrismaService,
    actor: Actor,
    scope: string,
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (
      !user.active ||
      !permission(user.role as Role, "read") ||
      (scope === "INTERNAL" && !permission(user.role as Role, "finance"))
    )
      throw new Fault("FORBIDDEN", "内部完整资料需要财务权限", 403);
  }
  @Access("read") @Post() async create(
    @Body() raw: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = input.parse(raw);
    await this.checkScope(this.db, req.actor, b.scope);
    return this.commands.run(
      req.actor.id,
      "materials.create",
      req.get("Idempotency-Key"),
      b,
      async (tx) => {
        await this.checkScope(tx, req.actor, b.scope);
        for (const row of [...b.items].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          const item = await itemLock(tx, row.id);
          versionMatch(item.version, row.version);
          if (item.dataMode !== b.dataMode)
            throw new Fault(
              "ITEM_SCOPE",
              "所选商品的数据范围已改变，请重新选择",
              409,
            );
        }
        const items = await tx.item.findMany({
          where: { id: { in: b.items.map((i) => i.id) } },
          include,
          orderBy: { serial: "asc" },
        });
        const bundle = await tx.materialExport.create({
          data: {
            createdBy: req.actor.id,
            title: b.title,
            scope: b.scope,
            dataMode: b.dataMode,
            entries: {
              create: items.map((item) => ({
                itemId: item.id,
                snapshot: json(material(item, b.scope)),
              })),
            },
          },
        });
        await audit(tx, req.actor.id, "MATERIAL_EXPORT_PREPARED", bundle.id, {
          count: items.length,
          scope: b.scope,
        });
        return { id: bundle.id, count: items.length };
      },
    );
  }
  @Access("read") @Get() async list(
    @Query() raw: unknown,
    @Req() req: AuthRequest,
  ) {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        dataMode: z.enum(["BUSINESS", "TEST"]).default("BUSINESS"),
      })
      .strict()
      .parse(raw);
    const where = {
      dataMode: q.dataMode,
      ...(permission(req.actor.role, "finance") ? {} : { scope: "OPERATIONS" }),
      entries: { some: { item: { dataMode: q.dataMode } } },
    };
    const [total, rows] = await this.db.$transaction([
      this.db.materialExport.count({ where }),
      this.db.materialExport.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
        skip: (q.page - 1) * 30,
        include: { _count: { select: { entries: true } } },
      }),
    ]);
    return { total, page: q.page, rows };
  }
  private async inspect(id: string, actor: Actor) {
    return this.db.$transaction(
      async (tx) => {
        const bundle = await tx.materialExport.findUniqueOrThrow({
          where: { id },
          include: { entries: { orderBy: { itemId: "asc" } } },
        });
        await this.checkScope(tx, actor, bundle.scope);
        const items = await tx.item.findMany({
          where: { id: { in: bundle.entries.map((e) => e.itemId) } },
          include,
        });
        const rows = bundle.entries.map((e) => {
          const item = items.find((i) => i.id === e.itemId),
            before = e.snapshot as unknown as Material;
          if (!item || item.dataMode !== bundle.dataMode)
            return {
              id: e.itemId,
              code: "",
              title: "已移出本数据范围",
              changes: ["数据范围"],
              current: null,
              before: null,
            };
          if (item.deletedAt)
            return {
              id: e.itemId,
              code: before.code,
              title: before.title,
              changes: ["已移入回收站"],
              current: null,
              before,
            };
          const current = material(item, bundle.scope);
          return {
            id: e.itemId,
            code: current.code,
            title: current.title,
            changes: differences(before, current),
            current,
            before,
          };
        });
        return {
          id: bundle.id,
          title: bundle.title,
          createdAt: bundle.createdAt,
          scope: bundle.scope,
          dataMode: bundle.dataMode,
          rows,
          items,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("read") @Get(":id") async detail(
    @Param("id") raw: string,
    @Req() req: AuthRequest,
  ) {
    const result = await this.inspect(uuid.parse(raw), req.actor);
    return {
      id: result.id,
      title: result.title,
      createdAt: result.createdAt,
      scope: result.scope,
      dataMode: result.dataMode,
      rows: result.rows,
    };
  }
  @Access("read") @Get(":id/download") async download(
    @Param("id") raw: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const result = await this.inspect(uuid.parse(raw), req.actor);
    if (result.rows.some((r) => r.changes.length))
      throw new Fault(
        "MATERIALS_CHANGED",
        "这批商品已有变化，请查看变化并重新整理资料包",
        409,
      );
    const rows = result.rows.map((r) => r.current!);
    const files = result.items.flatMap((item) =>
      item.assets
        .filter((a) => rows.some((r) => r.images.some((i) => i.id === a.id)))
        .map((a) => ({
          asset: a,
          image: rows.flatMap((r) => r.images).find((i) => i.id === a.id)!,
        })),
    );
    let total = 0;
    for (const file of files) {
      const p = assetPath(file.asset.objectKey),
        metadata = await stat(p);
      total += metadata.size;
      if (total > 2 * 1024 ** 3)
        throw new Fault("EXPORT_TOO_LARGE", "原图超过2GB，请分批下载", 400);
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(p)) digest.update(chunk);
      if (
        metadata.size !== file.asset.size ||
        digest.digest("hex") !== file.asset.sha256
      )
        throw new Fault(
          "ORIGINAL_INTEGRITY",
          "原图校验未通过，请先恢复原文件",
          409,
        );
    }
    // Recheck after potentially long original-file verification, including permissions.
    const fresh = await this.inspect(result.id, req.actor);
    if (fresh.rows.some((r) => r.changes.length))
      throw new Fault(
        "MATERIALS_CHANGED",
        "整理期间商品已变化，请重新核对",
        409,
      );
    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("error", (error) => res.destroy(error));
    res.on("close", () => {
      if (!res.writableFinished) archive.abort();
    });
    res.type("application/zip").attachment(`ToMe-${result.id}.zip`);
    archive.pipe(res);
    const manifest = {
      format: "tome-materials/1",
      id: result.id,
      createdAt: result.createdAt,
      amountUnit: "MINOR_UNIT_100",
      costCurrency: "CNY",
      scope: result.scope,
      usage:
        "内部参考资料；下载不代表图片获得对外使用许可或任何平台已发布。请在使用前核对当前库存和素材权限。",
      items: rows,
    };
    archive.append(JSON.stringify(manifest, null, 2), {
      name: "商品资料.json",
    });
    archive.append(materialCsv(rows, result.scope === "INTERNAL"), {
      name: "商品清单.csv",
    });
    for (const r of rows)
      archive.append(
        [
          r.code,
          r.title,
          `品牌：${r.brand || record(r.facts.attributes).sourceBrand || "未填写"}`,
          `状态：${statusNames[r.status]}`,
          `售价：${r.priceMinor == null ? "未填写" : (r.priceMinor / 100).toFixed(2) + " " + r.currency}`,
          ...Object.entries(r.facts)
            .filter(([, v]) => typeof v === "string" && v)
            .map(
              ([k, v]) =>
                `${({ sizeLabel: "尺码", conditionGrade: "本地成色", condition: "瑕疵说明", material: "材质", mainMaterial: "主要材质", color: "颜色", measurements: "尺寸", descriptionZh: "中文介绍", descriptionEn: "英文介绍" } as Record<string, string>)[k] || k}：${v}`,
            ),
          "",
          "来源图仅作内部参考，外部使用前请核对权限。",
        ].join("\n"),
        { name: `商品/${r.code}/商品资料.txt` },
      );
    for (const file of files)
      archive.file(assetPath(file.asset.objectKey), { name: file.image.path });
    await archive.finalize();
  }
}
