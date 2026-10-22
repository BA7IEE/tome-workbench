import { itemLock } from "../catalog/catalog.service";
import { Body, Controller, Get, Param, Post, Req, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Access, AuthRequest, permission } from "../auth/auth";
import { Commands, audit } from "../common/transaction";
import { safeText, uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { DistributionService } from "../distribution/distribution.service";
import { readWorkQueue } from "./work-queue";
import { WorkerService } from "./worker.service";
@ApiTags("工作与可靠执行")
@Controller("api")
export class JobsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private worker: WorkerService,
    private distribution: DistributionService,
  ) {}
  @Access("read") @Get("tasks") tasks() {
    return this.db.task.findMany({
      where: {
        kind: { not: "PREPARE" },
        item: { deletedAt: null, dataMode: "BUSINESS" },
      },
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
    const canPublish = permission(r.actor.role, "publish");
    const [inventory, queue, pendingDistribution, sold, pendingJobs] = await Promise.all([
      this.db.item.groupBy({
        by: ["status", "approvedValid"],
        where: { deletedAt: null, dataMode: "BUSINESS" },
        _count: { _all: true },
      }),
      readWorkQueue(this.db, r.actor.role, { scope: "ALL", size: 1 }),
      canPublish ? this.distribution.operationalAttentionCount() : 0,
      this.db.sale.count({ where: { item: { dataMode: "BUSINESS" } } }),
      this.db.outbox.count({ where: { status: { in: ["PENDING", "WORKING", "FAILED"] } } }),
    ]);
    const count = (test: (row: typeof inventory[number]) => boolean) =>
      inventory.filter(test).reduce((total, row) => total + row._count._all, 0);
    return {
      items: count(() => true),
      available: count(row => row.status === "AVAILABLE"),
      pendingItemReviews: count(row => !row.approvedValid),
      openTasks: queue.summary.tasks,
      unresolved: queue.summary.observations,
      pendingCandidates: queue.summary.candidates,
      pendingInquiries: queue.summary.inquiries,
      pendingDistribution,
      actionable: queue.summary.total,
      sold,
      pendingJobs,
    };
  }
}
