import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { guardDatabase } = require("./db-test-guard.cjs");
const raw = new URL(process.env.DATABASE_URL);
raw.pathname = "/tome_test";
guardDatabase(raw.toString());
process.env.DATABASE_URL = raw.toString();
process.env.APP_ENV = "test";
process.env.MEDIA_DIR = "./data/test-media";
process.env.EXTERNAL_EFFECTS_ENABLED = "false";
process.env.DISTRIBUTION_COMPAT_RUNTIME_ENABLED = "false";

const { createApp } = require("../dist/bootstrap");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  DistributionService,
} = require("../dist/distribution/distribution.service");
const { JobsController } = require("../dist/jobs/jobs.controller");
const { readWorkQueue } = require("../dist/jobs/work-queue");

const itemCount = 1000;
const channelCount = 8;
const assetCount = itemCount * 5;
const actorId = randomUUID();
let app;

async function truncate(db) {
  const tables = await db.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  for (const row of tables)
    assert.match(row.tablename, /^[A-Za-z][A-Za-z0-9_]*$/);
  if (tables.length)
    await db.$executeRawUnsafe(
      "TRUNCATE " +
        tables.map((row) => `"${row.tablename}"`).join(",") +
        " RESTART IDENTITY CASCADE",
    );
}

async function measure(name, work) {
  const started = process.hrtime.bigint();
  const result = await work();
  return {
    result,
    ms: Number(process.hrtime.bigint() - started) / 1_000_000,
    name,
  };
}

const report = {
  kind: "isolated-launch-scale-benchmark",
  at: new Date().toISOString(),
  source: "tome_test",
  externalActionsExecuted: 0,
  data: {
    items: itemCount,
    channels: channelCount,
    targetPairs: itemCount,
    historicalPairs: itemCount,
    assets: assetCount,
    attempts: itemCount + 200,
  },
  durationsMs: {},
  passed: false,
};

try {
  app = await createApp();
  const db = app.get(PrismaService);
  await truncate(db);

  const ids = Array.from({ length: itemCount }, () => randomUUID());
  const channels = Array.from({ length: channelCount }, (_, index) => ({
    id: randomUUID(),
    name: `基准渠道 ${index + 1}`,
    platform: `BENCH_${index + 1}`,
    locale: "zh-CN",
    titleLimit: 80,
    active: true,
    businessPurpose: "TRADE",
    defaultCurrency: "CNY",
  }));
  await db.$transaction(async (tx) => {
    await tx.channel.createMany({ data: channels });
    await tx.item.createMany({
      data: ids.map((id, index) => ({
        id,
        title: `规模基准商品 ${String(index + 1).padStart(4, "0")}`,
        facts: {},
        currentPrice: 10000,
        currency: "CNY",
        dataMode: "BUSINESS",
        status: "AVAILABLE",
        ownership: "OWN",
      })),
    });
    await tx.cycle.createMany({
      data: ids.map((itemId) => ({ itemId, number: 1 })),
    });
    await tx.asset.createMany({
      data: ids.flatMap((itemId, itemIndex) =>
        Array.from({ length: 5 }, (_, assetIndex) => ({
          itemId,
          objectKey: `benchmark/${itemIndex}/${assetIndex}.jpg`,
          originalName: `benchmark-${assetIndex}.jpg`,
          sha256: `${itemIndex}-${assetIndex}`.padEnd(64, "0"),
          mime: "image/jpeg",
          size: 1,
          role: "PRODUCT",
          origin: "OWN",
          rights: "PUBLIC",
          verified: true,
          position: assetIndex,
        })),
      ),
    });
    await tx.distributionTarget.createMany({
      data: ids.map((itemId, index) => ({
        itemId,
        channelId: channels[index % channelCount].id,
        active: true,
        note: "隔离规模基准",
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
    const historical = ids.map((itemId, index) => ({
      itemId,
      channelId: channels[(index + 1) % channelCount].id,
      action: "PUBLISH",
      state: "FAILED",
      dedupeKey: `benchmark-history-${index}`,
      errorCode: "BENCHMARK",
      errorMessage: "isolated scale fixture",
    }));
    await tx.distributionAttempt.createMany({
      data: [
        ...historical,
        ...historical.slice(0, 200).map((row, index) => ({
          ...row,
          action: "UPDATE",
          dedupeKey: `benchmark-history-update-${index}`,
        })),
      ],
    });
  });

  const distribution = app.get(DistributionService);
  const jobs = app.get(JobsController);
  const operations = await measure("operations", () =>
    distribution.operations({ page: 1, size: 100 }),
  );
  const dashboard = await measure("dashboard", () =>
    jobs.dashboard({ actor: { role: "ADMIN" } }),
  );
  const queue = await measure("workQueue", () =>
    readWorkQueue(db, "ADMIN", { scope: "ITEM_REVIEW", page: 1, size: 100 }),
  );
  report.durationsMs = {
    operations: operations.ms,
    dashboard: dashboard.ms,
    workQueue: queue.ms,
  };
  assert.equal(operations.result.summary.total, 2000);
  assert.equal(dashboard.result.pendingItemReviews, itemCount);
  assert.equal(queue.result.total, itemCount);
  for (const [name, duration] of Object.entries(report.durationsMs))
    assert.ok(
      duration <= 1000,
      `${name} exceeded 1000ms: ${duration.toFixed(1)}ms`,
    );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (app) {
    const db = app.get(PrismaService);
    try {
      await truncate(db);
    } catch (error) {
      report.cleanupError =
        error instanceof Error ? error.message : String(error);
      report.passed = false;
    }
    await app.close();
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(
    "reports/benchmark-launch-scale.json",
    JSON.stringify(report, null, 2),
  );
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
