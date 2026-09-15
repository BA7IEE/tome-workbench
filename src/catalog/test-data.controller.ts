import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Access, AuthRequest } from "../auth/auth";
import {
  Commands,
  audit,
  event,
  hash,
  json,
  type Tx,
} from "../common/transaction";
import { safeText, uuid, tm, expectedVersion } from "../common/domain";
import { itemLock, snapshot, versionMatch } from "./catalog.service";
import { Fault } from "../common/errors";
async function impact(tx: Tx, id: string) {
  const item = await tx.item.findUnique({ where: { id } });
  if (!item) throw new Fault("NOT_FOUND", "商品不存在", 404);
  const [sales, costs, listings, reservations, statements, observations] =
    await Promise.all([
      tx.sale.findMany({
        where: { itemId: id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          version: true,
          amount: true,
          cost: true,
          fees: true,
          currency: true,
          refunded: true,
          paid: true,
          returned: true,
          cooperation: true,
        },
      }),
      tx.costEntry.findMany({
        where: { itemId: id },
        orderBy: { id: "asc" },
        select: { id: true, amount: true, currency: true, status: true },
      }),
      tx.listing.findMany({
        where: { itemId: id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          url: true,
          desired: true,
          observed: true,
          observedAt: true,
          channel: { select: { name: true } },
        },
      }),
      tx.reservation.findMany({
        where: { itemId: id, status: "ACTIVE" },
        orderBy: { id: "asc" },
        select: { id: true, expiresAt: true },
      }),
      tx.settlementStatement.findMany({
        where: { lines: { some: { sale: { itemId: id } } } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          status: true,
          digest: true,
          currency: true,
          periodStart: true,
          periodEnd: true,
        },
      }),
      tx.observation.findMany({
        where: { itemId: id, resolved: false },
        orderBy: { id: "asc" },
        select: { id: true, kind: true, payload: true },
      }),
    ]);
  const inquiries = await tx.inquiry.findMany({
    where: { itemId: id },
    orderBy: { id: "asc" },
    select: {
      id: true,
      version: true,
      state: true,
      notes: true,
      quote: true,
      currency: true,
    },
  });
  const basis = {
    materialExports: await tx.materialExportEntry.findMany({
      where: { itemId: id },
      orderBy: { exportId: "asc" },
    }),
    inquiries,
    id: item.id,
    code: tm(item.serial),
    title: item.title,
    version: item.version,
    status: item.status,
    dataMode: item.dataMode,
    deletedAt: item.deletedAt,
    sales,
    costs,
    listings,
    reservations,
    statements,
    observations,
  };
  // Date values must be canonicalized to strings before hashing.
  return { ...basis, digest: hash(json(basis)) };
}
@ApiTags("测试数据清理")
@Controller("api/items")
export class TestDataController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("users") @Get(":id/test-cleanup-preview") preview(
    @Param("id") id: string,
  ) {
    return this.db.$transaction((tx) => impact(tx, uuid.parse(id)), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  @Access("users") @Post(":id/test-cleanup") cleanup(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = z
        .object({
          version: expectedVersion,
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          typedCode: safeText(30),
          reason: safeText(1000).min(3),
          noRealTransaction: z.literal(true),
          noRealPublication: z.literal(true),
          acknowledgeStatements: z.boolean().default(false),
        })
        .strict()
        .parse(raw);
    return this.commands.run(
      r.actor.id,
      "item.testCleanup",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id, true);
        versionMatch(item.version, b.version);
        if (b.typedCode !== tm(item.serial))
          throw new Fault(
            "TEST_CODE_MISMATCH",
            "商品编号不匹配，请输入当前商品的完整TM编号",
            400,
          );
        const current = await impact(tx, id);
        if (current.digest !== b.digest)
          throw new Fault(
            "TEST_PREVIEW_STALE",
            "关联交易、库存或商品已变化，请重新打开清理预览核对",
          );
        if (
          current.statements.some((s) => s.status === "CONFIRMED") &&
          !b.acknowledgeStatements
        )
          throw new Fault(
            "TEST_STATEMENT_ACK_REQUIRED",
            "涉及已确认对账，请查看影响并确认需要另做更正",
          );
        const updated = await tx.item.update({
          where: { id },
          data: {
            dataMode: "TEST",
            testMarkedAt: item.testMarkedAt || new Date(),
            testMarkedBy: item.testMarkedBy || r.actor.id,
            testReason: b.reason,
            deletedAt: new Date(),
            deletedBy: r.actor.id,
            deletionReason: "测试数据清理：" + b.reason,
            status: "PAUSED",
            approvedValid: false,
            version: { increment: 1 },
          },
        });
        await tx.reservation.updateMany({
          where: { itemId: id, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
        await tx.exceptionIntent.updateMany({
          where: { itemId: id, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
        // Target changes; observed platform state remains intact. This is not a real delisting receipt.
        await tx.listing.updateMany({
          where: { itemId: id },
          data: { desired: "OFFLINE" },
        });
        await tx.task.updateMany({
          where: { itemId: id, status: "OPEN" },
          data: {
            status: "CANCELLED",
            note: "管理员明确确认并归档测试数据；未执行外部下架",
          },
        });
        await tx.itemRevision.create({
          data: {
            itemId: id,
            version: updated.version,
            snapshot: json(await snapshot(tx, updated)),
          },
        });
        await audit(tx, r.actor.id, "TEST_DATA_ISOLATED", id, {
          reason: b.reason,
          previousMode: item.dataMode,
          code: tm(item.serial),
          sales: current.sales.length,
          costs: current.costs.length,
          statementIds: current.statements.map((s) => s.id),
          noRealTransaction: true,
          noRealPublication: true,
          financeRecordsPreserved: true,
        });
        await event(tx, id, "ITEM_TRASHED");
        return {
          id,
          code: tm(item.serial),
          dataMode: "TEST",
          archived: true,
          financeRecordsPreserved: true,
          confirmedStatementsNeedingReview: current.statements
            .filter((s) => s.status === "CONFIRMED")
            .map((s) => s.id),
        };
      },
    );
  }
}
