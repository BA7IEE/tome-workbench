import { Prisma, type Audit } from "@prisma/client";
import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Access } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { tm } from "../common/domain";
import { actionLabels, jobLabels, jobStates, jobHelp } from "./log-labels";
const isUuid = (s: string) => z.string().uuid().safeParse(s).success;
@Controller("api/operations")
export class LogsController {
  constructor(private db: PrismaService) {}
  @Access("audit") @Get("audit-logs") async audit(@Query() raw: unknown) {
    const b = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().max(100).default(""),
      })
      .strict()
      .parse(raw);
    const matching = Object.entries(actionLabels)
      .filter(([, v]) => v.includes(b.q))
      .map(([k]) => k);
    const q = b.q.trim();
    const joins = Prisma.sql`FROM "Audit" a LEFT JOIN "User" u ON u."id"::text=a."actorId"::text LEFT JOIN "Item" i ON i."id"::text=a."resourceId" LEFT JOIN "DictionaryEntry" d ON d."id"::text=a."resourceId"`;
    const filter = q
      ? Prisma.sql`WHERE strpos(lower(COALESCE(u."name",'')),lower(${q}))>0 OR strpos(lower(COALESCE(i."title",'')),lower(${q}))>0 OR strpos(lower(COALESCE(d."label",'')),lower(${q}))>0 OR strpos(lower(a."resourceId"),lower(${q}))>0 OR strpos(lower(a."action"),lower(${q}))>0 OR ('TM'||lpad(i."serial"::text,GREATEST(6,length(i."serial"::text)),'0'))=upper(${q}) OR ${matching.length ? Prisma.sql`a."action" IN (${Prisma.join(matching)})` : Prisma.sql`false`}`
      : Prisma.empty;
    const { total, rows, page } = await this.db.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total ${joins} ${filter}`,
        );
        const total = Number(counts[0].total),
          page = Math.min(b.page, Math.max(1, Math.ceil(total / 40)));
        const rows = await tx.$queryRaw<Audit[]>(
          Prisma.sql`SELECT a.* ${joins} ${filter} ORDER BY a."createdAt" DESC,a."id" DESC LIMIT 40 OFFSET ${(page - 1) * 40}`,
        );
        return { total, rows, page };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const targets = rows.map((r) => r.resourceId).filter(isUuid),
      actors = rows.map((r) => r.actorId).filter(isUuid);
    const [items, users, entries] = await Promise.all([
      this.db.item.findMany({
        where: { id: { in: targets } },
        select: { id: true, title: true, serial: true },
      }),
      this.db.user.findMany({
        where: { id: { in: actors } },
        select: { id: true, name: true },
      }),
      this.db.dictionaryEntry.findMany({
        where: { id: { in: targets } },
        select: { id: true, label: true },
      }),
    ]);
    return {
      total,
      page,
      size: 40,
      rows: rows.map((r) => {
        const item = items.find((i) => i.id === r.resourceId);
        return {
          ...r,
          actionLabel: actionLabels[r.action] || "其他系统操作",
          actorName:
            users.find((u) => u.id === r.actorId)?.name || "系统或历史账号",
          itemId: item?.id,
          targetName: item
            ? tm(item.serial) + " · " + item.title
            : entries.find((e) => e.id === r.resourceId)?.label || "业务记录",
        };
      }),
    };
  }
  @Access("users") @Get("background-jobs") async jobs(@Query() raw: unknown) {
    const b = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        status: z
          .enum(["", "FAILED", "PENDING", "WORKING", "DONE"])
          .default("FAILED"),
      })
      .strict()
      .parse(raw);
    const where = b.status ? { status: b.status } : {};
    const [total, rows] = await this.db.$transaction([
      this.db.outbox.count({ where }),
      this.db.outbox.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 40,
        skip: (b.page - 1) * 40,
      }),
    ]);
    const items = await this.db.item.findMany({
      where: { id: { in: rows.map((r) => r.itemId) } },
      select: { id: true, title: true, serial: true },
    });
    return {
      total,
      page: b.page,
      size: 40,
      rows: rows.map((r) => {
        const item = items.find((i) => i.id === r.itemId);
        return {
          id: r.id,
          itemId: r.itemId,
          kind: r.kind,
          status: r.status,
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt,
          nextAt: r.nextAt,
          eventLabel: jobLabels[r.kind] || "核对商品与渠道状态",
          statusLabel: jobStates[r.status] || "待核对",
          help: jobHelp(r.lastError, r.status),
          targetName: item
            ? tm(item.serial) + " · " + item.title
            : "关联商品记录",
        };
      }),
    };
  }
}
