import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Access, AuthRequest, permission } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, lock } from "../common/transaction";
import { Fault } from "../common/errors";
import { uuid } from "../common/domain";
import {
  dictionaryKind,
  dictionaryInput,
  dictionaryUpdate,
  normalizeTerm,
  termsOf,
} from "./dictionary-rules";
@ApiTags("字典管理")
@Controller("api/dictionaries")
export class DictionaryController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("read") @Get() async list(
    @Query() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        kind: dictionaryKind,
        q: z.string().max(100).default(""),
        category: z
          .enum(["", "CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"])
          .default(""),
        all: z.enum(["0", "1"]).default("0"),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        exact: z.enum(["0", "1"]).default("0"),
      })
      .strict()
      .parse(raw);
    if (b.all === "1" && !permission(r.actor.role, "dictionary"))
      throw new Fault("FORBIDDEN", "维护字典需要管理员权限", 403);
    const term = normalizeTerm(b.q),
      where: Prisma.DictionaryEntryWhereInput = {
        kind: b.kind,
        ...(b.all === "1" ? {} : { active: true }),
        ...(b.category
          ? {
              OR: [
                { categories: { isEmpty: true } },
                { categories: { has: b.category } },
              ],
            }
          : {}),
        ...(term
          ? {
              terms: {
                some: {
                  normalized: b.exact === "1" ? term : { contains: term },
                },
              },
            }
          : {}),
      };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.dictionaryEntry.count({ where }),
          page = Math.min(b.page, Math.max(1, Math.ceil(total / 40)));
        const rows = await tx.dictionaryEntry.findMany({
          where,
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }, { id: "asc" }],
          take: 40,
          skip: (page - 1) * 40,
          include: { _count: { select: { selections: true } } },
        });
        return { rows, total, page, size: 40 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("read") @Get(":id") async get(@Param("id") id: string) {
    const row = await this.db.dictionaryEntry.findUnique({
      where: { id: uuid.parse(id) },
      include: { _count: { select: { selections: true } } },
    });
    if (!row) throw new Fault("NOT_FOUND", "字典选项不存在", 404);
    return row;
  }
  @Access("dictionary") @Post() create(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = dictionaryInput.parse(raw);
    return this.commands.run(
      r.actor.id,
      "dictionary.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        await lock(tx, "dictionary:catalog");
        const terms = termsOf(b),
          code =
            b.code || "ENTRY_" + randomUUID().replace(/-/g, "").toUpperCase();
        if (b.kind === "CONDITION")
          throw new Fault(
            "CONDITION_STANDARD_LOCKED",
            "成色使用VC五级口径，不新增混合等级",
            400,
          );
        if (
          await tx.dictionaryEntry.findUnique({
            where: { kind_code: { kind: b.kind, code: code } },
          })
        )
          throw new Fault(
            "DICTIONARY_CODE_EXISTS",
            "编码已存在，请使用另一个编码",
          );
        const collision = await tx.dictionaryTerm.findFirst({
          where: { kind: b.kind, normalized: { in: terms } },
          include: { entry: true },
        });
        if (collision)
          throw new Fault(
            "DICTIONARY_DUPLICATE",
            `名称或别名已属于“${collision.entry.label}”，请复用原选项`,
          );
        const row = await tx.dictionaryEntry.create({
          data: {
            ...b,
            code,
            categories: [...new Set(b.categories)],
            aliases: [...new Set(b.aliases)],
          },
        });
        await tx.dictionaryTerm.createMany({
          data: terms.map((normalized) => ({
            entryId: row.id,
            kind: b.kind,
            normalized,
          })),
        });
        await audit(tx, r.actor.id, "DICTIONARY_CREATED", row.id, {
          kind: b.kind,
          code: code,
          label: b.label,
        });
        return row;
      },
    );
  }
  @Access("dictionary") @Post(":id") update(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = dictionaryUpdate.parse(raw);
    return this.commands.run(
      r.actor.id,
      "dictionary.update",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "dictionary:catalog");
        const old = await tx.dictionaryEntry.findUnique({ where: { id } });
        if (!old) throw new Fault("NOT_FOUND", "字典选项不存在", 404);
        if (old.version !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "字典已被其他人修改，请重新读取后合并",
          );
        const terms = termsOf(b),
          collision = await tx.dictionaryTerm.findFirst({
            where: {
              kind: old.kind,
              normalized: { in: terms },
              entryId: { not: id },
            },
            include: { entry: true },
          });
        if (collision)
          throw new Fault(
            "DICTIONARY_DUPLICATE",
            `名称或别名已属于“${collision.entry.label}”，不能重复创建`,
          );
        if (
          old.kind === "CONDITION" &&
          (b.label !== old.label ||
            b.labelEn !== old.labelEn ||
            b.description !== old.description ||
            b.categories.length)
        )
          throw new Fault(
            "CONDITION_STANDARD_LOCKED",
            "成色名称及定义按VC口径保留，不能任意改写",
            400,
          );
        const { version, ...values } = b;
        const row = await tx.dictionaryEntry.update({
          where: { id },
          data: {
            ...values,
            version: version + 1,
            categories: [...new Set(b.categories)],
            aliases: [...new Set(b.aliases)],
          },
        });
        await tx.dictionaryTerm.deleteMany({ where: { entryId: id } });
        await tx.dictionaryTerm.createMany({
          data: terms.map((normalized) => ({
            entryId: id,
            kind: old.kind,
            normalized,
          })),
        });
        await audit(tx, r.actor.id, "DICTIONARY_UPDATED", id, {
          before: {
            label: old.label,
            active: old.active,
            version: old.version,
          },
          after: { label: row.label, active: row.active, version: row.version },
        });
        return row;
      },
    );
  }
}
