import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Client } from "pg";
import runtimeLock from "./runtime-lock.cjs";
const dbURL = new URL(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
);
const runtimeURL = new URL(process.env.DATABASE_URL);
if (dbURL.host !== runtimeURL.host || dbURL.pathname !== runtimeURL.pathname)
  throw new Error("Migration and runtime database targets differ");
if (!/^\/tome_[a-z0-9_]+$/.test(dbURL.pathname))
  throw new Error("Dedicated tome_ database required");
const production = process.env.APP_ENV === "production";
if (
  production &&
  (!process.argv.includes("--production") ||
    process.env.TOME_DEPLOY_APPROVED !== "YES")
)
  throw new Error(
    "Production migration requires --production and TOME_DEPLOY_APPROVED=YES",
  );
if (!production && !process.argv.includes("--local"))
  throw new Error("Explicit --local acknowledgement required");
if (
  !production &&
  !["127.0.0.1", "localhost", "postgres"].includes(dbURL.hostname)
)
  throw new Error("Local migration cannot target a remote host");
process.env.DATABASE_URL = dbURL.toString();
const release = await runtimeLock.maintenance();
const db = new Client({
  connectionString: dbURL.toString(),
  connectionTimeoutMillis: 5000,
});
try {
  await db.connect();
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'",
  );
  if (production && !process.argv.includes("--initial-empty")) {
    const f = process.env.BACKUP_MANIFEST;
    if (!f)
      throw new Error("Existing production database requires BACKUP_MANIFEST");
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    if (
      m.database !== dbURL.pathname.slice(1) ||
      m.format !== 1 ||
      Date.now() - Date.parse(m.at) > 86400000 ||
      !m.files?.["database.dump"]
    )
      throw new Error(
        "Backup evidence missing, expired or for another database",
      );
  }
  if (
    production &&
    process.argv.includes("--initial-empty") &&
    tables.rows.some((r) => r.tablename !== "_prisma_migrations")
  )
    throw new Error("Initial deployment requires an empty schema");
  if (tables.rows.some((r) => r.tablename === "_prisma_migrations")) {
    const rows = await db.query(
      'SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"',
    );
    for (const r of rows.rows) {
      if (r.rolled_back_at) continue;
      if (!r.finished_at)
        throw new Error("An unfinished migration requires manual resolution");
      if (!/^[a-zA-Z0-9_-]+$/.test(r.migration_name))
        throw new Error("Unexpected migration identity");
      const f = `prisma/migrations/${r.migration_name}/migration.sql`;
      if (
        !fs.existsSync(f) ||
        crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") !==
          r.checksum
      )
        throw new Error(
          "Applied migration is missing or changed: " + r.migration_name,
        );
    }
  }
  await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { stdio: "inherit", env: process.env },
    );
    p.once("error", reject);
    p.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error("Migration failed: " + String(code ?? signal))),
    );
  });
  console.log("MIGRATION_VERIFIED_AND_APPLIED; no reset performed");
} finally {
  await db.end().catch(() => {});
  await release();
}
