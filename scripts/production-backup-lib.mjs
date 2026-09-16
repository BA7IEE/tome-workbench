import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
export const arg = (name, fallback) =>
  process.argv.find((s) => s.startsWith(name + "="))?.slice(name.length + 1) ||
  fallback;
export function context() {
  const dir = path.resolve(arg("--config-dir", "data/production"));
  const project = arg("--project", "tome-production");
  if (!/^tome-[a-z0-9-]+$/.test(project))
    throw new Error("Invalid Compose project");
  const config = JSON.parse(
    fs.readFileSync(path.join(dir, "configuration.json"), "utf8"),
  );
  const compose = [
    "compose",
    "-p",
    project,
    "-f",
    "compose.production.yaml",
    "--env-file",
    path.join(dir, "compose.env"),
  ];
  return { dir, project, config, compose };
}
export async function docker(args) {
  try {
    return (
      await exec("docker", args, { maxBuffer: 32 * 1024 * 1024 })
    ).stdout.trim();
  } catch {
    throw new Error(
      "Docker backup operation failed; inspect the owned Compose project locally",
    );
  }
}
export async function offlineProject(ctx) {
  for (const service of ["api-a", "api-b", "worker-a", "worker-b"]) {
    if (
      await docker([...ctx.compose, "ps", "--status", "running", "-q", service])
    )
      throw new Error(
        "Stop both API and Worker replicas before backup: " + service,
      );
  }
  const postgres = await docker([...ctx.compose, "ps", "-q", "postgres"]);
  if (!postgres) throw new Error("Project PostgreSQL must be running");
  const [info] = JSON.parse(await docker(["inspect", postgres]));
  if (
    info.Config.Labels?.["com.docker.compose.project"] !== ctx.project ||
    !info.Config.Env.includes("POSTGRES_DB=tome_production")
  )
    throw new Error("Database ownership mismatch");
}
export class SqlSession {
  constructor(ctx, database = "tome_production") {
    if (
      database !== "tome_production" &&
      !/^tome_restore_[a-z0-9]+$/.test(database)
    )
      throw new Error("Invalid database target");
    this.child = spawn(
      "docker",
      [
        ...ctx.compose,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "tome_owner",
        "-d",
        database,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.buffer = "";
    this.child.stderr.resume(); // Never copy database diagnostics or connection details into reports.
    this.child.stdout.on("data", (b) => {
      this.buffer += b.toString();
      if (this.pending && this.buffer.includes(this.pending.marker + "\n")) {
        const value = this.buffer
          .slice(0, this.buffer.indexOf(this.pending.marker + "\n"))
          .trim();
        this.buffer = this.buffer.slice(
          this.buffer.indexOf(this.pending.marker + "\n") +
            this.pending.marker.length +
            1,
        );
        clearTimeout(this.pending.timer);
        this.pending.resolve(value);
        this.pending = null;
      }
    });
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => this.fail());
    this.child.stdin.on("error", () => this.fail());
  }
  fail() {
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(
        new Error("Maintenance SQL session ended or query failed"),
      );
      this.pending = null;
    }
  }
  query(sql) {
    if (this.closed || this.pending)
      throw new Error("Maintenance SQL session unavailable");
    return new Promise((resolve, reject) => {
      const marker = "tome_" + crypto.randomBytes(12).toString("hex");
      const timer = setTimeout(() => {
        this.child.kill();
        this.fail();
      }, 60000);
      this.pending = { marker, resolve, reject, timer };
      this.child.stdin.write(sql + ";\n\\echo " + marker + "\n");
    });
  }
  close() {
    this.child.stdin.end("\\q\n");
  }
}
export async function maintenanceSession(ctx) {
  const db = new SqlSession(ctx);
  try {
    const held = await db.query(
      "SELECT pg_try_advisory_lock(1414483269,20260910)",
    );
    if (held !== "t")
      throw new Error(
        "Stop all API, Worker and CLI writers; maintenance gate is held",
      );
    const active = await db.query(
      "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state IS DISTINCT FROM 'idle'",
    );
    if (active !== "0")
      throw new Error(
        "Database has active clients; maintenance window not confirmed",
      );
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
export async function databaseSnapshot(db) {
  await db.query("SET TIME ZONE 'UTC'");
  const names = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  )
    .split("\n")
    .filter(Boolean);
  const models = {};
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
      throw new Error("Unexpected table identity");
    const row = await db.query(
      `SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(row_to_json(t)::text) h FROM "${name}" t) rows`,
    );
    models[name] = JSON.parse(row);
  }
  const migrations = JSON.parse(
    await db.query(
      `SELECT COALESCE(json_agg(x ORDER BY migration_name),'[]') FROM (SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations") x`,
    ),
  );
  const sequence = JSON.parse(
    await db.query(`SELECT row_to_json(s) FROM "Item_serial_seq" s`),
  );
  return { models, migrations, sequence };
}
export function fileManifest(root) {
  const files = {};
  const walk = (dir) => {
    if (fs.lstatSync(dir).isSymbolicLink())
      throw new Error("Backup symlink refused");
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Backup symlink refused");
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) {
        files[path.relative(root, target).split(path.sep).join("/")] = sha256(
          fs.readFileSync(target),
        );
      } else throw new Error("Non-regular backup entry refused");
    }
  };
  walk(root);
  return files;
}
export function verifyBackup(root) {
  if (fs.lstatSync(root).isSymbolicLink())
    throw new Error("Backup root symlink refused");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    manifest.database !== "tome_production" ||
    !manifest.files?.["database.dump"] ||
    !manifest.files?.["migration-manifest.json"] ||
    !manifest.files?.["media-manifest.json"] ||
    !manifest.files?.["model-manifest.json"]
  )
    throw new Error("Incomplete production backup");
  const actual = fileManifest(root);
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (actual[name] !== digest)
      throw new Error("Backup checksum mismatch: " + name);
  }
  if (
    Object.keys(actual).some(
      (n) =>
        !["manifest.json", "checksums.sha256"].includes(n) &&
        !Object.hasOwn(manifest.files, n),
    )
  )
    throw new Error("Unlisted backup file");
  const expected =
    Object.entries({
      ...manifest.files,
      "manifest.json": sha256(
        fs.readFileSync(path.join(root, "manifest.json")),
      ),
    })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, h]) => `${h}  ${n}`)
      .join("\n") + "\n";
  if (fs.readFileSync(path.join(root, "checksums.sha256"), "utf8") !== expected)
    throw new Error("Checksum manifest mismatch");
  return manifest;
}
export async function dumpDatabase(ctx, file) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          ...ctx.compose,
          "exec",
          "-T",
          "postgres",
          "pg_dump",
          "-U",
          "tome_owner",
          "-d",
          "tome_production",
          "-Fc",
          "--no-owner",
          "--no-acl",
        ],
        { stdio: ["ignore", fd, "ignore"] },
      );
      child.once("error", () => reject(new Error("Dump failed")));
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Dump failed")),
      );
    });
  } finally {
    fs.closeSync(fd);
  }
}
