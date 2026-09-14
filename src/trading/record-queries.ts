import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { contribution, safeText, tm, uuid } from "../common/domain";

const validDate = (value: string) =>
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export const recordQuery = z
  .object({
    id: uuid.optional(),
    itemId: uuid.optional(),
    q: safeText(150).default(""),
    channel: safeText(120).default(""),
    customer: safeText(200).default(""),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    page: z.coerce.number().int().min(1).max(100000).optional(),
    size: z.coerce.number().int().min(1).max(100).default(50),
    dataMode: z.enum(["BUSINESS", "TEST"]).default("BUSINESS"),
    state: z.enum(["", "OPEN", "FOLLOWUP", "WON", "LOST"]).default(""),
    listingState: z.enum(["", "LIVE", "OFFLINE"]).default(""),
    pending: z.enum(["", "1"]).default(""),
    export: z.enum(["", "1"]).default(""),
  })
  .strict()
  .refine(
    (q) =>
      (!q.dateFrom || validDate(q.dateFrom)) &&
      (!q.dateTo || validDate(q.dateTo)) &&
      (!q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo),
    "日期范围不正确",
  );
export function itemSearch(q: string): Prisma.ItemWhereInput {
  const serial = /^TM\d{6,}$/i.test(q) ? Number(q.slice(2)) : 0;
  return q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          ...(Number.isSafeInteger(serial) && serial > 0 ? [{ serial }] : []),
        ],
      }
    : {};
}
export const dateRange = (q: { dateFrom?: string; dateTo?: string }) =>
  q.dateFrom || q.dateTo
    ? {
        ...(q.dateFrom
          ? { gte: new Date(q.dateFrom + "T00:00:00+08:00") }
          : {}),
        ...(q.dateTo
          ? {
              lt: new Date(Date.parse(q.dateTo + "T00:00:00+08:00") + 86400000),
            }
          : {}),
      }
    : undefined;
export const pendingFinance: Prisma.SaleWhereInput = {
  OR: [{ amount: null }, { cost: null }, { fees: null }, { paid: false }],
};
export async function readSales(db: PrismaService, raw: unknown) {
  const q = recordQuery.parse(raw),
    page = q.page || 1;
  const where: Prisma.SaleWhereInput = {
    ...(q.id ? { id: q.id } : {}),
    ...(q.itemId ? { itemId: q.itemId } : {}),
    item: { dataMode: q.dataMode, ...itemSearch(q.q) },
    channel: { contains: q.channel, mode: "insensitive" },
    customerRef: { contains: q.customer, mode: "insensitive" },
    soldAt: dateRange(q),
    ...(q.pending ? pendingFinance : {}),
  };
  return db.$transaction(
    async (tx) => {
      const rows = (
        await tx.sale.findMany({
          where,
          include: {
            item: {
              select: {
                serial: true,
                title: true,
                dataMode: true,
                deletedAt: true,
              },
            },
            adjustments: true,
          },
          orderBy: [{ soldAt: "desc" }, { id: "asc" }],
          ...(q.export
            ? {}
            : q.page
              ? { skip: (page - 1) * q.size, take: q.size }
              : { take: 1000 }),
        })
      ).map((s) => ({
        ...s,
        code: tm(s.item.serial),
        contribution: contribution(s),
      }));
      if (!q.page && !q.export) return rows; // Legacy bounded array; operator pages explicitly use pagination.
      const complete: Prisma.SaleWhereInput = {
        cooperation: "INCLUDED",
        paid: true,
        amount: { not: null },
        cost: { not: null },
        fees: { not: null },
      };
      const [total, excluded, groups] = await Promise.all([
        tx.sale.count({ where }),
        tx.sale.count({ where: { AND: [where, { cooperation: "EXCLUDED" }] } }),
        tx.sale.groupBy({
          by: ["currency", "returned"],
          where: { AND: [where, complete] },
          _sum: { amount: true, refunded: true, cost: true, fees: true },
          _count: { _all: true },
        }),
      ]);
      const totals: Record<string, number> = {};
      let included = 0;
      for (const g of groups) {
        included += g._count._all;
        const s = g._sum;
        totals[g.currency] =
          (totals[g.currency] || 0) +
          (s.amount || 0) -
          (s.refunded || 0) -
          (g.returned ? 0 : s.cost || 0) -
          (s.fees || 0);
      }
      if (Object.values(totals).some((v) => !Number.isSafeInteger(v)))
        throw new Error("汇总金额超出安全范围，请缩小日期范围");
      return {
        rows,
        total,
        page,
        size: q.size,
        summary: {
          totals,
          pending: total - excluded - included,
          excluded,
          included,
        },
        scope: { dateFrom: q.dateFrom, dateTo: q.dateTo, dataMode: q.dataMode },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function readInquiries(db: PrismaService, raw: unknown) {
  const q = recordQuery.parse(raw),
    page = q.page || 1;
  const where: Prisma.InquiryWhereInput = {
    ...(q.id ? { id: q.id } : {}),
    ...(q.itemId ? { itemId: q.itemId } : {}),
    item: { deletedAt: null, dataMode: "BUSINESS", ...itemSearch(q.q) },
    channel: { contains: q.channel, mode: "insensitive" },
    customerRef: { contains: q.customer, mode: "insensitive" },
    ...(q.state ? { state: q.state } : {}),
    createdAt: dateRange(q),
  };
  return db.$transaction(
    async (tx) => {
      const rows = await tx.inquiry.findMany({
        where,
        include: { item: { select: { id: true, serial: true, title: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...(q.page
          ? { skip: (page - 1) * q.size, take: q.size }
          : { skip: 0, take: 500 }),
      });
      return q.page
        ? { rows, total: await tx.inquiry.count({ where }), page, size: q.size }
        : rows;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
