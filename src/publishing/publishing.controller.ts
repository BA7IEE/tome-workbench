import sharp from "sharp";
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
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import archiver from "archiver";
import { z } from "zod";
import { Access, AuthRequest, Public, permission } from "../auth/auth";
import { Commands, audit, lock, event } from "../common/transaction";
import { recordQuery, itemSearch, dateRange } from "../trading/record-queries";
import { Prisma } from "@prisma/client";
import { Fault } from "../common/errors";
import { currency, uuid, safeText } from "../common/domain";
import { PrismaService } from "../database/prisma.service";
import { assetPath } from "../media/media.controller";
import { PublishingService, purpose } from "./publishing.service";
import { DistributionService } from "../distribution/distribution.service";

const endpointUrl = z.union([z.literal(""), z.string().url().max(2000)]);
function safeEndpoint(value: string) {
  if (!value) return value;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Fault("INVALID_URL", "仅允许HTTP/HTTPS站点地址", 400);
  if (url.username || url.password)
    throw new Fault("SENSITIVE_ENDPOINT_DENIED", "站点地址不得包含登录信息", 400);
  if (
    [...url.searchParams.keys()].some((key) =>
      /(?:token|secret|signature|password|api[_-]?key|access[_-]?(?:token|key)|credential|cookie|session|auth)/i.test(
        key,
      ),
    ) ||
    /(?:^|[?&#;])(?:token|secret|signature|password|api[_-]?key|access[_-]?(?:token|key)|credential|cookie|session|auth)\s*=/i.test(
      url.hash,
    )
  )
    throw new Fault("SENSITIVE_ENDPOINT_DENIED", "站点地址不得包含访问凭据", 400);
  return value;
}
@ApiTags("使用与分发")
@Controller("api")
export class PublishingController {
  constructor(
    private db: PrismaService,
    private service: PublishingService,
    private commands: Commands,
    private distribution: DistributionService,
  ) {}
  @Access("read") @Get("channels") channels() {
    return this.db.channel.findMany({ orderBy: { createdAt: "asc" } });
  }
  @Access("users") @Post("channels") channel(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        name: safeText(120).min(1),
        platform: z.enum([
          "XIANYU",
          "XHS",
          "VC",
          "CAROUSELL",
          "SHOWROOM",
          "ANQICMS",
          "GRAILED",
          "OTHER",
        ]),
        locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
        titleLimit: z.number().int().min(16).max(300).default(80),
        defaultCurrency: currency.default("CNY"),
        distributionMode: z
          .enum(["MANUAL", "API", "AGENT", "SCRIPT"])
          .default("MANUAL"),
        endpointUrl: endpointUrl.default(""),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "channel.create",
      r.get("Idempotency-Key"),
      { ...b, endpointUrl: safeEndpoint(b.endpointUrl) },
      async (tx) => {
        const c = await tx.channel.create({
          data: { ...b, endpointUrl: safeEndpoint(b.endpointUrl) },
        });
        await audit(tx, r.actor.id, "CHANNEL_CREATED", c.id);
        return c;
      },
    );
  }
  @Access("users") @Post("channels/:id") updateChannel(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        version: z.number().int().positive(),
        name: safeText(120).min(1),
        locale: z.enum(["zh-CN", "en"]),
        titleLimit: z.number().int().min(16).max(300),
        active: z.boolean(),
        defaultCurrency: currency.optional(),
        distributionMode: z
          .enum(["MANUAL", "API", "AGENT", "SCRIPT"])
          .optional(),
        endpointUrl: endpointUrl.optional(),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "channel.update",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        await lock(tx, "channel:" + id);
        const before = await tx.channel.findUniqueOrThrow({ where: { id } });
        if (before.version !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "渠道刚被修改，请重新读取后核对",
            409,
          );
        const { version, ...data } = b;
        const updated = await tx.channel.update({
          where: { id },
          data: {
            ...data,
            defaultCurrency: data.defaultCurrency ?? before.defaultCurrency,
            distributionMode: data.distributionMode ?? before.distributionMode,
            endpointUrl:
              data.endpointUrl === undefined
                ? before.endpointUrl
                : safeEndpoint(data.endpointUrl),
            version: version + 1,
          },
        });
        await audit(tx, r.actor.id, "CHANNEL_UPDATED", id, {
          before,
          after: updated,
        });
        const affected = await tx.listing.findMany({
          where: { channelId: id },
          select: { itemId: true },
          distinct: ["itemId"],
        });
        for (const row of affected)
          await event(tx, row.itemId, "CHANNEL_CHANGED", { channelId: id });
        return { id, version: updated.version };
      },
    );
  }
  @Access("read") @Get("items/:id/readiness") readiness(
    @Param("id") id: string,
    @Query("channelId") c: string,
    @Query("purpose") p = "TRADE",
  ) {
    return this.service.readiness(
      uuid.parse(id),
      uuid.parse(c),
      purpose.parse(p),
    );
  }
  @Access("edit") @Post("items/:id/prepare") prepare(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.prepare(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("publish") @Get("items/:id/package-preview") preview(
    @Param("id") id: string,
    @Query("channelId") c: string,
  ) {
    return this.service.preview(uuid.parse(id), uuid.parse(c));
  }
  @Access("publish") @Post("items/:id/packages") pack(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.create(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("publish") @Get("packages/:id") async get(@Param("id") id: string) {
    return this.db.usePackage.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
  }
  @Access("publish") @Get("packages/:id/download") async download(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() r: AuthRequest,
    @Query("imageType") imageType = "jpeg",
  ) {
    const outputType = z.enum(["jpeg", "webp"]).parse(imageType);
    const { s, assets } = await this.db.$transaction((tx) =>
      this.service.validPackage(tx, uuid.parse(id)),
    );
    await this.db.$transaction((tx) =>
      audit(tx, r.actor.id, "PACKAGE_DOWNLOADED", id),
    );
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${s.code}-materials.zip"`,
      "Cache-Control": "private, no-store",
    });
    const zip = archiver("zip", { zlib: { level: 6 } });
    zip.on("error", () => res.destroy());
    zip.pipe(res);
    zip.append(
      JSON.stringify(
        {
          ...s,
          exportRecipe: {
            imageType: outputType,
            maxEdge: 2400,
            originalsUnchanged: true,
          },
        },
        null,
        2,
      ),
      { name: `${s.code}/manifest.json` },
    );
    zip.append(s.title, { name: `${s.code}/标题.txt` });
    zip.append(s.body, { name: `${s.code}/正文.txt` });
    zip.append(
      s.title +
        "\n\n" +
        s.body +
        `\n\n${s.code}\n${s.currency} ${s.price === null ? "待询价" : (s.price / 100).toFixed(2)}`,
      { name: `${s.code}/文案.txt` },
    );
    for (let index = 0; index < s.assets.length; index++) {
      const a = assets.find((a) => a.id === s.assets[index].id)!;
      const bytes =
        outputType === "jpeg"
          ? await sharp(assetPath(a.objectKey), { limitInputPixels: 40000000 })
              .rotate()
              .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
              .flatten({ background: "#ffffff" })
              .jpeg({ quality: 92 })
              .toBuffer()
          : await readFile(assetPath(a.objectKey) + ".webp");
      zip.append(bytes, {
        name: `${s.code}/${String(index + 1).padStart(2, "0")}_${s.code}.${outputType === "jpeg" ? "jpg" : "webp"}`,
      });
    }
    await zip.finalize();
  }
  @Access("read") @Get("listings") listings(
    @Query() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const q = recordQuery.parse(raw),
      page = q.page || 1;
    if (q.dataMode === "TEST" && !permission(r.actor.role, "users"))
      throw new Fault("FORBIDDEN", "测试发布记录需要管理员权限", 403);
    const where: Prisma.ListingWhereInput = {
      ...(q.id ? { id: q.id } : {}),
      ...(q.itemId ? { itemId: q.itemId } : {}),
      item: { dataMode: q.dataMode, ...itemSearch(q.q) },
      channel: { name: { contains: q.channel, mode: "insensitive" } },
      createdAt: dateRange(q),
      ...(q.listingState ? { desired: q.listingState } : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.listing.findMany({
          where,
          include: {
            channel: true,
            item: {
              select: {
                id: true,
                serial: true,
                title: true,
                status: true,
                dataMode: true,
                deletedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: q.page ? (page - 1) * q.size : 0,
          take: q.page ? q.size : 1000,
        });
        return q.page
          ? {
              rows,
              total: await tx.listing.count({ where }),
              page,
              size: q.size,
            }
          : rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("publish") @Post("listings") receipt(
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.distribution.listingReceipt(
      r.actor,
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("publish") @Post("listings/:id/observe") observe(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.observe(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Public() @Get("showroom") async showroom() {
    const rows = await this.db.listing.findMany({
      where: {
        item: { dataMode: "BUSINESS" },
        channel: { platform: "SHOWROOM", active: true },
        desired: "LIVE",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const result = [];
    for (const row of rows) {
      try {
        const { s, p } = await this.db.$transaction((tx) =>
          this.service.validPackage(tx, row.packageId, false, true),
        );
        result.push({ id: p.id, ...s });
      } catch {
        /* stale/blocked entries are intentionally omitted */
      }
    }
    return result;
  }
  @Public() @Get("showroom/:id/image/:asset") async publicImage(
    @Param("id") id: string,
    @Param("asset") asset: string,
    @Res() res: Response,
  ) {
    const l = await this.db.listing.findFirstOrThrow({
      where: {
        packageId: uuid.parse(id),
        desired: "LIVE",
        item: { dataMode: "BUSINESS" },
        channel: { platform: "SHOWROOM", active: true },
      },
    });
    const { assets } = await this.db.$transaction((tx) =>
      this.service.validPackage(tx, l.packageId, false, true),
    );
    const a = assets.find((x) => x.id === uuid.parse(asset));
    if (!a) {
      res.sendStatus(404);
      return;
    }
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(await readFile(assetPath(a.objectKey) + ".webp"));
  }
}
