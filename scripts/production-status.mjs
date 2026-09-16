// Read-only collector for an independently operated monitor. No notifications or credentials in output.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { arg, context, docker, SqlSession } from "./production-backup-lib.mjs";
const ctx = context(),
  caFile = arg("--ca", "");
const checks = {};
const tls = await new Promise((resolve) => {
  const req = https.get(
    ctx.config.origin + "/api/system/ready",
    { timeout: 5000, ...(caFile ? { ca: fs.readFileSync(caFile) } : {}) },
    (res) => {
      const certificate = res.socket.getPeerCertificate();
      res.resume();
      resolve({
        ready: res.statusCode === 200,
        certificateDays: Math.floor(
          (Date.parse(certificate.valid_to) - Date.now()) / 86400000,
        ),
      });
    },
  );
  req.on("error", () => resolve({ ready: false, certificateDays: null }));
  req.on("timeout", () => req.destroy());
});
checks.ready = tls.ready;
checks.certificate = tls.certificateDays !== null && tls.certificateDays >= 14;
let failedOutbox = null,
  mediaFreeBytes = null,
  databaseDiskPercent = null;
const db = new SqlSession(ctx);
try {
  checks.database = (await db.query("SELECT 1")) === "1";
  failedOutbox = Number(
    await db.query("SELECT count(*) FROM \"Outbox\" WHERE status='FAILED'"),
  );
  checks.outbox = failedOutbox === 0;
} catch {
  checks.database = false;
  checks.outbox = false;
} finally {
  db.close();
}
try {
  mediaFreeBytes = Number(
    await docker([
      ...ctx.compose,
      "exec",
      "-T",
      "api-a",
      "node",
      "-e",
      'const s=require("node:fs").statfsSync("/app/data/media");console.log(s.bavail*s.bsize)',
    ]),
  );
  checks.mediaDisk =
    Number.isFinite(mediaFreeBytes) && mediaFreeBytes >= 1024 ** 3;
  const df = await docker([
    ...ctx.compose,
    "exec",
    "-T",
    "postgres",
    "df",
    "-P",
    "/var/lib/postgresql/data",
  ]);
  databaseDiskPercent = Number(
    df.trim().split("\n").at(-1).trim().split(/\s+/)[4]?.replace("%", ""),
  );
  checks.databaseDisk =
    Number.isFinite(databaseDiskPercent) && databaseDiskPercent < 90;
} catch {
  checks.mediaDisk = false;
  checks.databaseDisk = false;
}
let lastBackupAt = null;
const backupDir = path.join(ctx.dir, "backups");
if (fs.existsSync(backupDir)) {
  for (const dir of fs.readdirSync(backupDir)) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(backupDir, dir, "manifest.json"), "utf8"),
      );
      if (manifest.database !== "tome_production" || !manifest.databaseSha256)
        continue;
      const at = Date.parse(manifest.createdAt);
      if (
        Number.isFinite(at) &&
        at <= Date.now() &&
        (!lastBackupAt || at > Date.parse(lastBackupAt))
      )
        lastBackupAt = manifest.createdAt;
    } catch {
      /* An incomplete backup is not a successful backup. */
    }
  }
}
checks.backupAge =
  !!lastBackupAt && Date.now() - Date.parse(lastBackupAt) <= 86400000;
const passed = Object.values(checks).every(Boolean);
console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      passed,
      checks,
      certificateDays: tls.certificateDays,
      failedOutbox,
      mediaFreeBytes,
      databaseDiskPercent,
      lastBackupAt,
      notificationDelivered: false,
      rehearsal: ctx.config.rehearsal,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
