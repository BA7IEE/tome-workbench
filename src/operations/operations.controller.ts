import { Controller, Get } from "@nestjs/common";
import { Access } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { RequestMonitor } from "./request-monitor";
@Controller("api/operations")
@Access("users")
export class OperationsController {
  constructor(
    private db: PrismaService,
    private monitor: RequestMonitor,
  ) {}
  @Get("status") async status() {
    const now = new Date(),
      cutoff = new Date(now.getTime() - 20000);
    const [heartbeats, jobs, oldest, failed, delists] = await Promise.all([
      this.db.runtimeHeartbeat.findMany({
        where: { lastSeen: { gt: new Date(now.getTime() - 86400000) } },
        orderBy: { lastSeen: "desc" },
        take: 100,
      }),
      this.db.outbox.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.outbox.findFirst({
        where: { status: { in: ["PENDING", "WORKING"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.db.outbox.count({ where: { status: "FAILED" } }),
      this.db.task.count({ where: { kind: "DELIST", status: "OPEN" } }),
    ]);
    const healthy = heartbeats.filter(
      (h) => h.state === "RUNNING" && h.lastSeen > cutoff,
    );
    return {
      at: now,
      process: this.monitor.snapshot(),
      instances: heartbeats.map((h) => ({
        ...h,
        healthy: h.state === "RUNNING" && h.lastSeen > cutoff,
      })),
      queue: jobs,
      oldestPendingSeconds: oldest
        ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1000)
        : 0,
      failedJobs: failed,
      manualDelistingTasks: delists,
      warnings: [
        ...(healthy.some((h) => h.kind === "worker")
          ? []
          : ["NO_HEALTHY_WORKER"]),
        ...(failed ? ["FAILED_JOBS"] : []),
      ],
      guarantees: {
        externalEffects: false,
        storage: "shared-local-volume",
        databaseRedundancy: "deployment-dependent-not-proven",
        productionHA: false,
      },
    };
  }
}
