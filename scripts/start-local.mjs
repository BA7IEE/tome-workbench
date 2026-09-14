import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(cmd, args) {
  const p = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
  });
  if (p.error || p.status !== 0)
    throw new Error(cmd + " failed; no migration or startup will follow");
}
function checkRunning() {
  if (!fs.existsSync("data/run")) return;
  for (const name of fs
    .readdirSync("data/run")
    .filter((n) => n.endsWith(".json"))) {
    const row = JSON.parse(
      fs.readFileSync(path.join("data/run", name), "utf8"),
    );
    if (!Number.isInteger(row.pid) || row.pid < 2)
      throw new Error("Invalid runtime marker: " + name);
    try {
      process.kill(row.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") continue;
      throw e;
    }
    throw new Error("兔泥巴已有运行进程。升级前请先停止原进程，不重复迁移。");
  }
}
try {
  checkRunning();
  if (!fs.existsSync(".env")) run(process.execPath, ["scripts/initialize.mjs"]);
  if (
    process.env.APP_ENV === "production" ||
    /^APP_ENV\s*=\s*["']?production/m.test(fs.readFileSync(".env", "utf8"))
  )
    throw new Error("本地启动器不能用于生产升级，请使用生产部署手册。");
  const hash = createHash("sha256")
    .update(fs.readFileSync("package-lock.json"))
    .digest("hex");
  const cached = fs.existsSync("data/install-lock.sha256")
    ? fs.readFileSync("data/install-lock.sha256", "utf8")
    : "";
  if (!fs.existsSync("node_modules/pg") || cached !== hash) {
    run(npm, ["ci", "--no-fund"]);
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/install-lock.sha256", hash);
  }
  await import("dotenv/config");
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  run(npm, ["run", "db:generate"]);
  const { Client } = await import("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  let needsBackup = false;
  try {
    await db.connect();
    const exists = await db.query(
      "SELECT to_regclass('public._prisma_migrations') AS name",
    );
    if (exists.rows[0].name) {
      const applied = await db.query(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      );
      const local = fs
        .readdirSync("prisma/migrations")
        .filter((n) =>
          fs.existsSync(path.join("prisma/migrations", n, "migration.sql")),
        );
      needsBackup = local.some(
        (n) => !applied.rows.some((r) => r.migration_name === n),
      );
    }
  } finally {
    await db.end();
  }
  if (needsBackup) {
    console.log("检测到数据库升级：先创建离线备份，失败则不迁移。");
    run(process.execPath, ["scripts/backup.mjs", "--offline-confirmed"]);
  }
  run(process.execPath, ["scripts/migrate-safe.mjs", "--local"]);
  run(npm, ["run", "build"]);
  const child = spawn(process.execPath, ["scripts/cluster.mjs"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => child.kill("SIGTERM"));
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  console.log("工作台以2个API和2个Worker启动；Ctrl+C安全停止，不删除数据。");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
