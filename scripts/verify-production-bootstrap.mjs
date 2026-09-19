import { spawnSync } from "node:child_process";
import { Client } from "pg";

if (process.env.TOME_BOOTSTRAP_TEST_APPROVED !== "YES")
  throw new Error("Set TOME_BOOTSTRAP_TEST_APPROVED=YES for isolated CI bootstrap verification");

const base = new URL(process.env.DATABASE_URL || "");
if (!base.hostname || !base.username)
  throw new Error("CI DATABASE_URL is required");
const dbName = "tome_bootstrap_ci";
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
const ownerUrl = new URL(base);
ownerUrl.pathname = "/" + dbName;
const runtimeUrl = new URL(ownerUrl);
runtimeUrl.username = "tome_app";
runtimeUrl.password = "bootstrap-runtime-ci-only";

const admin = new Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
    [dbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query("DROP ROLE IF EXISTS tome_app");
  await admin.query(`CREATE DATABASE ${dbName}`);

  const migrated = spawnSync(
    process.execPath,
    ["scripts/migrate-safe.mjs", "--production", "--initial-empty"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        APP_ENV: "production",
        TOME_DEPLOY_APPROVED: "YES",
        DATABASE_URL: runtimeUrl.toString(),
        MIGRATION_DATABASE_URL: ownerUrl.toString(),
        EXTERNAL_EFFECTS_ENABLED: "false",
      },
    },
  );
  if (migrated.status !== 0)
    throw new Error(
      "Fresh production bootstrap failed:\n" +
        (migrated.stdout || "") +
        (migrated.stderr || ""),
    );

  const runtime = new Client({ connectionString: runtimeUrl.toString() });
  try {
    await runtime.connect();
    const result = await runtime.query(
      'SELECT current_user, COUNT(*)::int AS migrations FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL GROUP BY current_user',
    );
    if (
      result.rows[0]?.current_user !== "tome_app" ||
      result.rows[0]?.migrations < 1
    )
      throw new Error("Runtime role did not survive fresh production bootstrap");
  } finally {
    await runtime.end().catch(() => {});
  }
  console.log("PRODUCTION_BOOTSTRAP_VERIFIED");
} finally {
  if (admin._connected) {
    await admin
      .query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [dbName],
      )
      .catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
    await admin.query("DROP ROLE IF EXISTS tome_app").catch(() => {});
  }
  await admin.end().catch(() => {});
}
