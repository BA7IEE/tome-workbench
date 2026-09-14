import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient, Prisma } from "@prisma/client";
const require = createRequire(import.meta.url);
const { guardDatabase } = require("./db-test-guard.cjs");
const { runtime } = require("./runtime-lock.cjs");
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/tome_test";
guardDatabase(url.toString());
process.env.DATABASE_URL = url.toString();
process.env.MEDIA_DIR = "./data/test-media";
const models = Prisma.dmmf.datamodel.models.map(
  (m) => m.name[0].toLowerCase() + m.name.slice(1),
);
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
async function snapshot(db) {
  const result = {};
  for (const m of models) {
    const rows = (await db[m].findMany()).map((r) => JSON.stringify(r)).sort();
    result[m] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
function run(file, args = []) {
  const r = spawnSync(process.execPath, [file, ...args], {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(file + " failed: " + r.stderr);
  return r.stdout.trim().split("\n").at(-1);
}
const before = new PrismaClient();
let after;
try {
  const release = await runtime("api");
  try {
    const blocked = spawnSync(
      process.execPath,
      ["scripts/backup.mjs", "--offline-confirmed"],
      { env: process.env, encoding: "utf8" },
    );
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Stop this database API/);
  } finally {
    await release();
  }
  const original = await snapshot(before);
  const max =
    (await before.item.aggregate({ _max: { serial: true } }))._max.serial || 0;
  const backup = run("scripts/backup.mjs", ["--offline-confirmed"]);
  const target = "tome_restore_" + Date.now().toString(36);
  run("scripts/restore.mjs", [backup, target]);
  const restoredUrl = new URL(url);
  restoredUrl.pathname = "/" + target;
  after = new PrismaClient({
    datasources: { db: { url: restoredUrl.toString() } },
  });
  const restored = await snapshot(after);
  assert.deepEqual(restored, original);
  const next = await after.$queryRawUnsafe(
    `SELECT nextval(pg_get_serial_sequence('"Item"','serial')) AS value`,
  );
  assert.ok(Number(next[0].value) > max);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(backup, "manifest.json"), "utf8"),
  );
  let mediaCount = 0;
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (name.startsWith("media/")) {
      const p = path.join("data", "restore-" + target, name.slice(6));
      assert.equal(hash(fs.readFileSync(p)), digest);
      mediaCount++;
    }
  }
  const report = {
    kind: "actual-local-offline-recovery-drill",
    at: new Date().toISOString(),
    passed: true,
    source: "tome_test",
    target,
    checks: {
      liveProcessBlocksBackup: true,
      allSelectedTableHashesEqual: true,
      tmSequenceBeyondMaximum: true,
      restoredMediaChecksumsEqual: true,
    },
    tables: original,
    comparedModelCount: models.length,
    mediaFiles: mediaCount,
    externalActionsExecuted: 0,
  };
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/recovery.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await before.$disconnect();
  await after?.$disconnect();
}
