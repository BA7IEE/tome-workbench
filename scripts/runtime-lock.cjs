// Dedicated PostgreSQL session owns the lock. Never use pooled session-level locks.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const GATE = [1414483269, 20260910];
function dbName() {
  const name = new URL(process.env.DATABASE_URL).pathname.slice(1);
  if (!/^tome_[a-z0-9_]+$/.test(name))
    throw new Error("Independent tome_ database required");
  return name;
}
async function acquire(exclusive, kind) {
  dbName();
  const id = randomUUID();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `tome-${kind}-${id}`,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 1000,
  });
  let released = false,
    timer,
    marker,
    beating = false;
  const fatal = () => {
    if (released) return;
    console.error("RUNTIME_LEASE_LOST: stopping to prevent unprotected writes");
    process.exit(1);
  };
  client.on("error", fatal);
  try {
    await client.connect();
    const fn = exclusive
      ? "pg_try_advisory_lock"
      : "pg_try_advisory_lock_shared";
    const r = await client.query(`SELECT ${fn}($1,$2) AS ok`, GATE);
    if (!r.rows[0].ok)
      throw new Error(
        exclusive
          ? "Stop this database API and Worker before backup/restore (database-wide gate)"
          : "Database maintenance in progress",
      );
    if (!exclusive) {
      const history = await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"',
      );
      const rows = history.rows.filter((r) => !r.rolled_back_at);
      const directory = path.resolve(__dirname, "../prisma/migrations");
      const names = fs
        .readdirSync(directory)
        .filter((n) => fs.existsSync(path.join(directory, n, "migration.sql")))
        .sort();
      if (
        rows.some((r) => !r.finished_at) ||
        names.length !== rows.length ||
        rows.some((r) => !names.includes(r.migration_name))
      )
        throw new Error("Schema migration history mismatch");
      for (const name of names) {
        const checksum = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(directory, name, "migration.sql")))
          .digest("hex");
        if (
          !rows.some(
            (r) => r.migration_name === name && r.checksum === checksum,
          )
        )
          throw new Error("Applied migration checksum mismatch: " + name);
      }
      if (process.env.APP_ENV === "production") {
        const role = await client.query(
          "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        if (Object.values(role.rows[0] || {}).some(Boolean))
          throw new Error(
            "Production runtime requires a least-privilege database role",
          );
        const owned = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LIMIT 1",
        );
        if (owned.rowCount)
          throw new Error("Production runtime must not own application tables");
      }
      await client.query(
        'INSERT INTO "RuntimeHeartbeat" ("id","kind","pid","state","lastSeen","startedAt") VALUES ($1,$2,$3,\'RUNNING\',NOW(),NOW())',
        [id, kind, process.pid],
      );
      const dir = path.resolve(process.env.RUNTIME_DIR || "data/run");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      marker = path.join(dir, `${dbName()}-${kind}-${id}.json`);
      fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, id, kind }), {
        flag: "wx",
        mode: 0o600,
      });
      timer = setInterval(async () => {
        if (released || beating) return;
        beating = true;
        try {
          await client.query(
            'UPDATE "RuntimeHeartbeat" SET "lastSeen"=NOW() WHERE "id"=$1',
            [id],
          );
        } catch {
          fatal();
        } finally {
          beating = false;
        }
      }, 5000);
      timer.unref();
    }
  } catch (error) {
    released = true;
    await client.end().catch(() => {});
    throw error;
  }
  const release = async () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    if (!exclusive)
      await client
        .query(
          'UPDATE "RuntimeHeartbeat" SET "state"=\'STOPPED\',"lastSeen"=NOW() WHERE "id"=$1',
          [id],
        )
        .catch(() => {});
    if (marker)
      try {
        fs.unlinkSync(marker);
      } catch {}
    await client.end(); // releases the advisory lock on the exact owning connection
  };
  release.instanceId = id;
  release.heartbeat = async (details = {}) => {
    if (released || exclusive) return;
    const state = details.state || "RUNNING";
    if (!["RUNNING", "DRAINING"].includes(state))
      throw new Error("Invalid heartbeat state");
    await client.query(
      'UPDATE "RuntimeHeartbeat" SET "state"=$2,"lastSeen"=NOW() WHERE "id"=$1',
      [id, state],
    );
  };
  return release;
}
function runtime(kind) {
  return acquire(false, kind);
}
function maintenance() {
  return acquire(true, "maintenance");
}
module.exports = { dbName, runtime, maintenance };
