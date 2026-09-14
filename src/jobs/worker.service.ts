import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { itemLock } from "../catalog/catalog.service";
import { PublishingService } from "../publishing/publishing.service";
import { Fault } from "../common/errors";
import { Tx, audit } from "../common/transaction";
import { assetUsable, factsSchema } from "../common/domain";
@Injectable()
export class WorkerService {
  constructor(
    private db: PrismaService,
    private publishing: PublishingService,
  ) {}
  async reconcile(tx: Tx, itemId: string) {
    const item = await itemLock(tx, itemId, true);
    if (item.deletedAt) return; // Acknowledges old events without reviving deleted inventory.
    await tx.reservation.updateMany({
      where: { itemId, status: "ACTIVE", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
    if (
      item.status === "RESERVED" &&
      !(await tx.reservation.findFirst({ where: { itemId, status: "ACTIVE" } }))
    ) {
      // No automatic relisting after expiry. A human must decide to offer it again.
      await tx.item.update({
        where: { id: itemId },
        data: { status: "PAUSED" },
      });
    }
    const listings = await tx.listing.findMany({
      where: { itemId },
      include: { channel: true },
    });
    for (const l of listings) {
      let invalid = l.desired === "OFFLINE";
      if (!invalid) {
        try {
          await this.publishing.validPackage(tx, l.packageId);
        } catch (e) {
          if (e instanceof Fault) invalid = true;
          else throw e;
        }
      }
      if (invalid) {
        await tx.listing.update({
          where: { id: l.id },
          data: {
            desired: "OFFLINE",
            ...(l.channel.platform === "SHOWROOM"
              ? { observed: "SYSTEM_OFFLINE", observedAt: new Date() }
              : {}),
          },
        });
        if (
          l.channel.platform !== "SHOWROOM" &&
          !["MANUAL_REPORTED_OFFLINE", "SYSTEM_OFFLINE"].includes(l.observed)
        ) {
          await tx.task.upsert({
            where: { dedupeKey: "delist:" + l.id },
            create: {
              itemId,
              listingId: l.id,
              dedupeKey: "delist:" + l.id,
              kind: "DELIST",
              title: `请在 ${l.channel.name} 核对并下架`,
            },
            update: { status: "OPEN" },
          });
        }
      }
    }
    const current = await tx.item.findUniqueOrThrow({ where: { id: itemId } }),
      f = factsSchema.parse(current.facts);
    const assets = await tx.asset.findMany({ where: { itemId } }),
      offer = await tx.offer.findFirst({
        where: { itemId, status: "CONFIRMED", validUntil: { gt: new Date() } },
      });
    const measurementWaiver = await tx.requirementWaiver.findFirst({
      where: {
        itemId,
        code: "measurements",
        category: current.category,
        status: "ACTIVE",
      },
    });
    const satisfied: Record<string, boolean> = {
      brand: !!current.brand,
      title: !!current.title,
      images: assets.some((a) => assetUsable(a)),
      condition: !!f.condition,
      measurements:
        !!measurementWaiver || (!!f.measurements && !!f.measurementSource),
      authentication:
        f.authentication.status === "PASSED" && !!f.authentication.evidence,
      price: current.currentPrice !== null,
      supply: current.ownership === "OWN" || !!offer,
      availability: current.status === "AVAILABLE",
      english: !!f.descriptionEn,
      copy: !!f.descriptionZh,
    };
    for (const [code, ok] of Object.entries(satisfied))
      if (ok)
        await tx.task.updateMany({
          where: {
            dedupeKey: `req:${itemId}:${code}`,
            kind: "PREPARE",
            status: "OPEN",
          },
          data: { status: "SATISFIED" },
        });
  }
  private leaseSeconds() {
    const value = Number(process.env.WORKER_LEASE_SECONDS || 60);
    const min = process.env.APP_ENV === "test" ? 2 : 30;
    if (!Number.isInteger(value) || value < min || value > 300)
      throw new Error("Invalid worker lease duration");
    return value;
  }
  async claimNext() {
    const token = randomUUID(),
      seconds = this.leaseSeconds();
    // Crashes must consume the same finite budget as ordinary failures.
    await this.db
      .$executeRaw`UPDATE "Outbox" SET "status"='FAILED',"leaseToken"=NULL,"leaseUntil"=NULL,"lastError"='LEASE_EXHAUSTED'
      WHERE "status"='WORKING' AND "leaseUntil"<NOW() AND "attempts">=8`;
    const picked = await this.db.$queryRaw<
      { id: string; itemId: string }[]
    >(Prisma.sql`
      WITH picked AS (
        SELECT "id" FROM "Outbox" WHERE "attempts"<8 AND
          (("status"='PENDING' AND "nextAt"<=NOW()) OR ("status"='WORKING' AND "leaseUntil"<NOW()))
        ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE "Outbox" o SET "status"='WORKING',"leaseUntil"=NOW()+make_interval(secs=>${seconds}),
        "leaseToken"=${token},"attempts"="attempts"+1 FROM picked WHERE o."id"=picked."id"
        RETURNING o."id",o."itemId"`);
    return picked.length ? { ...picked[0], token } : null;
  }
  async executeClaim(job: { id: string; itemId: string; token: string }) {
    try {
      await this.db.$transaction(
        async (tx) => {
          // Lock the claimed row, then the Item. Reclaimers SKIP this row; stale owners cannot commit.
          const valid = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "Outbox"
          WHERE "id"=${job.id}::uuid AND "leaseToken"=${job.token} AND "status"='WORKING'
          AND "leaseUntil">NOW() FOR UPDATE`;
          if (!valid.length) return;
          await this.reconcile(tx, job.itemId);
          const done = await tx.outbox.updateMany({
            where: { id: job.id, leaseToken: job.token, status: "WORKING" },
            data: {
              status: "DONE",
              leaseToken: null,
              leaseUntil: null,
              lastError: null,
            },
          });
          if (done.count !== 1)
            throw new Fault("LEASE_LOST", "Worker租约已被重新领取");
        },
        {
          maxWait: 1000,
          timeout: Math.min(30000, this.leaseSeconds() * 1000 - 250),
        },
      );
    } catch (error) {
      const current = await this.db.outbox.findUnique({
        where: { id: job.id },
      });
      const attempts = current?.attempts || 1;
      await this.db.outbox.updateMany({
        where: { id: job.id, leaseToken: job.token, status: "WORKING" },
        data: {
          status: attempts >= 8 ? "FAILED" : "PENDING",
          nextAt: new Date(Date.now() + Math.min(300000, 2 ** attempts * 1000)),
          leaseToken: null,
          leaseUntil: null,
          lastError:
            error instanceof Fault ? "BUSINESS_ERROR" : "RETRYABLE_ERROR",
        },
      });
    }
  }
  async tick() {
    const job = await this.claimNext();
    if (!job) return false;
    await this.executeClaim(job);
    return true;
  }
  async sweep() {
    const token = randomUUID();
    await this.db.sweepLease.upsert({
      where: { id: "expiry" },
      create: { id: "expiry" },
      update: {},
    });
    const picked = await this.db.$queryRaw<
      { cursor: string | null }[]
    >`UPDATE "SweepLease"
      SET "token"=${token},"leaseUntil"=NOW()+INTERVAL '60 seconds'
      WHERE "id"='expiry' AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW()) RETURNING "cursor"`;
    if (!picked.length) return { scanned: 0, errors: 0, leaseClaimed: false };
    let cursor = picked[0].cursor,
      scanned = 0,
      errors = 0;
    const deadline = Date.now() + 5000;
    try {
      const rows = await this.db.item.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        orderBy: { id: "asc" },
        take: 25,
        select: { id: true },
      });
      for (const row of rows) {
        if (scanned && Date.now() > deadline) break;
        try {
          await this.db.$transaction((tx) => this.reconcile(tx, row.id), {
            maxWait: 1000,
            timeout: 5000,
          });
        } catch {
          errors++;
          // One corrupt item must not starve expiries for all later items.
          if (
            !(await this.db.outbox.findFirst({
              where: {
                itemId: row.id,
                status: { in: ["PENDING", "WORKING", "FAILED"] },
              },
            }))
          )
            await this.db.outbox.create({
              data: { itemId: row.id, kind: "SWEEP_RETRY", payload: {} },
            });
        }
        cursor = row.id;
        scanned++;
      }
      if (scanned === rows.length && rows.length < 25) cursor = null;
      await this.db.sweepLease.updateMany({
        where: { id: "expiry", token },
        data: { cursor, token: null, leaseUntil: null },
      });
      await this.db.loginThrottle.deleteMany({
        where: { resetAt: { lt: new Date() } },
      });
      await this.db.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return { scanned, errors, leaseClaimed: true };
    } catch (error) {
      await this.db.sweepLease
        .updateMany({
          where: { id: "expiry", token },
          data: { token: null, leaseUntil: null },
        })
        .catch(() => {});
      throw error;
    }
  }
  async retry(id: string, actor: string) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.outbox.updateMany({
        where: { id, status: "FAILED" },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAt: new Date(),
          lastError: null,
        },
      });
      if (changed.count !== 1)
        throw new Fault("JOB_NOT_FAILED", "只有已失败任务可以重试");
      await audit(tx, actor, "JOB_RETRIED", id);
      return { id };
    });
  }
}
