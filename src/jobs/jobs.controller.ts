import { itemLock } from "../catalog/catalog.service";
import { Body, Controller, Get, Param, Post, Req, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Access, AuthRequest, permission } from "../auth/auth";
import { Commands, audit } from "../common/transaction";
import { safeText, uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { readWorkQueue } from "./work-queue";
import { WorkerService } from "./worker.service";
@ApiTags("工作与可靠执行")
@Controller("api")
export class JobsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private worker: WorkerService,
  ) {}
  @Access("read") @Get("tasks") tasks() {
    return this.db.task.findMany({
      where: { item: { deletedAt: null, dataMode: "BUSINESS" } },
      include: {
        item: { select: { id: true, serial: true, title: true } },
        listing: { include: { channel: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
  }
  @Access("edit") @Post("tasks/:id") task(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        status: z.enum(["OPEN", "DONE"]),
        assignee: safeText(100).default(""),
        note: safeText(2000).default(""),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "task.update",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const task = await tx.task.findUniqueOrThrow({ where: { id } });
        await itemLock(tx, task.itemId);
        if (task.kind === "DELIST" && b.status === "DONE")
          throw new Fault(
            "RECEIPT_REQUIRED",
            "下架任务必须通过对应渠道回执完成，不能直接勾掉",
          );
        await tx.task.update({ where: { id }, data: b });
        await audit(tx, r.actor.id, "TASK_UPDATED", task.itemId, {
          taskId: id,
          status: b.status,
        });
        return { id };
      },
    );
  }
  @Access("read") @Get("work-queue") workQueue(
    @Req() r: AuthRequest,
    @Query() raw: unknown,
  ) {
    return readWorkQueue(this.db, r.actor.role, raw);
  }

  @Access("users") @Get("jobs") jobs() {
    return this.db.outbox.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
  @Access("users") @Post("jobs/:id/retry") retry(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    return this.worker.retry(uuid.parse(id), r.actor.id);
  }
  @Access("audit") @Get("audit") audit() {
    return this.db.audit.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
  @Access("read") @Get("dashboard") async dashboard(@Req() r: AuthRequest) {
    const canSell = permission(r.actor.role, "sell"),
      canPublish = permission(r.actor.role, "publish"),
      canFinance = permission(r.actor.role, "finance");
    const [
      items,
      available,
      openTasks,
      sold,
      unresolved,
      pendingJobs,
      pendingCandidates,
      pendingInquiries,
      pendingSalesFinance,
      pendingDistribution,
    ] = await Promise.all([
      this.db.item.count({
        where: { deletedAt: null, dataMode: "BUSINESS" },
      }),
      this.db.item.count({
        where: { deletedAt: null, dataMode: "BUSINESS", status: "AVAILABLE" },
      }),
      this.db.task.count({
        where: {
          status: "OPEN",
          item: { deletedAt: null, dataMode: "BUSINESS" },
        },
      }),
      this.db.sale.count({ where: { item: { dataMode: "BUSINESS" } } }),
      this.db.observation.count({
        where: { resolved: false, item: { dataMode: "BUSINESS" } },
      }),
      this.db.outbox.count({
        where: { status: { in: ["PENDING", "WORKING", "FAILED"] } },
      }),
      this.db.ingestCandidate.count({ where: { decision: "PENDING" } }),
      this.db.inquiry.count({
        where: {
          state: { in: ["OPEN", "FOLLOWUP"] },
          item: { deletedAt: null, dataMode: "BUSINESS" },
        },
      }),
      this.db.sale.count({
        where: {
          item: { deletedAt: null, dataMode: "BUSINESS" },
          OR: [
            { amount: null },
            { cost: null },
            { fees: null },
            { paid: false },
          ],
        },
      }),
      this.db.distributionAttempt.count({
        where: {
          OR: [
            { state: { in: ["UNKNOWN", "FAILED"] } },
            { action: "DELIST", state: { in: ["PENDING", "RUNNING"] } },
          ],
          item: { deletedAt: null, dataMode: "BUSINESS" },
        },
      }),
    ]);
    const visibleInquiries = canSell ? pendingInquiries : 0,
      visibleDistribution = canPublish ? pendingDistribution : 0,
      visibleSalesFinance = canFinance ? pendingSalesFinance : 0,
      actionable =
        openTasks +
        unresolved +
        pendingCandidates +
        visibleDistribution +
        visibleInquiries +
        visibleSalesFinance;
    return {
      items,
      available,
      openTasks,
      sold,
      unresolved,
      pendingJobs,
      pendingCandidates,
      pendingDistribution: visibleDistribution,
      pendingInquiries: visibleInquiries,
      pendingSalesFinance: visibleSalesFinance,
      actionable,
    };
  }
}
