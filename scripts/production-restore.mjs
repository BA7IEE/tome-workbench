import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  arg,
  context,
  docker,
  SqlSession,
  databaseSnapshot,
  verifyBackup,
  fileManifest,
} from "./production-backup-lib.mjs";
const ctx = context();
const backup = arg("--backup", ""),
  target = arg("--target", ""),
  mediaArg = arg("--media-dir", "");
if (!backup || !/^tome_restore_[a-z0-9]+$/.test(target) || !mediaArg)
  throw new Error(
    "Use --backup=... --target=tome_restore_unique --media-dir=new-directory; production cannot be overwritten",
  );
const root = path.resolve(backup),
  media = path.resolve(mediaArg);
const manifest = verifyBackup(root);
if (fs.existsSync(media))
  throw new Error("Restore media directory must not exist");
// createdb refuses existing targets; never DROP or reset a database.
await docker([
  ...ctx.compose,
  "exec",
  "-T",
  "postgres",
  "createdb",
  "-U",
  "tome_owner",
  target,
]);
const fd = fs.openSync(path.join(root, "database.dump"), "r");
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        ...ctx.compose,
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        "tome_owner",
        "-d",
        target,
        "--no-owner",
        "--no-acl",
        "--single-transaction",
      ],
      { stdio: [fd, "ignore", "ignore"] },
    );
    child.once("error", () =>
      reject(new Error("Restore failed; isolated target retained")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Restore failed; isolated target retained")),
    );
  });
} finally {
  fs.closeSync(fd);
}
fs.cpSync(path.join(root, "media"), media, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
fs.chmodSync(media, 0o700);
const expectedMedia = JSON.parse(
  fs.readFileSync(path.join(root, "media-manifest.json"), "utf8"),
);
if (JSON.stringify(fileManifest(media)) !== JSON.stringify(expectedMedia))
  throw new Error("Restored media hashes differ");
const db = new SqlSession(ctx, target);
try {
  await db.query("SET default_transaction_read_only=on");
  const restored = await databaseSnapshot(db);
  const expected = JSON.parse(
    fs.readFileSync(path.join(root, "model-manifest.json"), "utf8"),
  );
  const migrations = JSON.parse(
    fs.readFileSync(path.join(root, "migration-manifest.json"), "utf8"),
  );
  if (
    JSON.stringify(restored.models) !== JSON.stringify(expected.models) ||
    JSON.stringify(restored.sequence) !== JSON.stringify(expected.sequence) ||
    JSON.stringify(restored.migrations) !== JSON.stringify(migrations)
  )
    throw new Error("Restored database/migration/TM sequence differs");
  const sample = JSON.parse(
    await db.query(
      `SELECT COALESCE(json_agg(x),'[]') FROM (SELECT id,serial FROM "Item" ORDER BY md5(id::text) LIMIT 30) x`,
    ),
  );
  const report = {
    at: new Date().toISOString(),
    passed: true,
    appVersion: manifest.appVersion,
    target,
    media,
    modelsVerified: Object.keys(restored.models).length,
    migrationsVerified: migrations.length,
    mediaFilesVerified: Object.keys(expectedMedia).length,
    tmSequenceVerified: true,
    readOnlyDatabaseChecks: true,
    sampleIds: sample,
    businessUat: false,
    applicationStarted: false,
    workerStarted: false,
    publicDeployment: false,
  };
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(
    "reports/production-recovery.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      passed: true,
      target,
      modelsVerified: report.modelsVerified,
      businessUat: false,
      applicationStarted: false,
    }),
  );
} finally {
  db.close();
}
