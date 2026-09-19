import { randomUUID } from "node:crypto";
import { Client } from "pg";

const RUNTIME_ROLE = "tome_app";

function runtimeIdentity(runtimeUrl) {
  const url = runtimeUrl instanceof URL ? runtimeUrl : new URL(runtimeUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = url.pathname.slice(1);
  if (user !== RUNTIME_ROLE)
    throw new Error("Production runtime database user must be tome_app");
  if (!password) throw new Error("Production runtime database password is empty");
  if (!/^tome_[a-z0-9_]+$/.test(database))
    throw new Error("Independent tome_ database required");
  return { user, password, database };
}

async function quoteLiteral(db, value) {
  const result = await db.query("SELECT quote_literal($1) AS value", [value]);
  return result.rows[0].value;
}

async function quoteIdent(db, value) {
  const result = await db.query("SELECT quote_ident($1) AS value", [value]);
  return result.rows[0].value;
}

export async function ensureProductionRuntimeRole(db, runtimeUrl) {
  const { password, database } = runtimeIdentity(runtimeUrl);
  const passwordLiteral = await quoteLiteral(db, password);
  const databaseIdent = await quoteIdent(db, database);
  const owner = await db.query("SELECT current_user AS name");
  const ownerIdent = await quoteIdent(db, owner.rows[0].name);
  const existing = await db.query(
    "SELECT 1 FROM pg_roles WHERE rolname=$1",
    [RUNTIME_ROLE],
  );
  if (existing.rowCount) {
    await db.query(
      `ALTER ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  } else {
    await db.query(
      `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  }
  await db.query(
    `ALTER ROLE ${RUNTIME_ROLE} SET statement_timeout = '20s'`,
  );
  await db.query(`ALTER ROLE ${RUNTIME_ROLE} SET lock_timeout = '5s'`);
  await db.query(
    `ALTER ROLE ${RUNTIME_ROLE} SET idle_in_transaction_session_timeout = '30s'`,
  );
  await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await db.query(
    `GRANT CONNECT ON DATABASE ${databaseIdent} TO ${RUNTIME_ROLE}`,
  );
  await db.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
  await db.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${RUNTIME_ROLE}`,
  );
  await db.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${RUNTIME_ROLE}`,
  );
}

export async function grantProductionRuntimePrivileges(db) {
  await db.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`,
  );
  await db.query(
    `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE}`,
  );
}

export async function verifyProductionRuntimeRole(runtimeUrl) {
  runtimeIdentity(runtimeUrl);
  const db = new Client({ connectionString: runtimeUrl.toString() });
  try {
    await db.connect();
    const role = await db.query(
      "SELECT current_user, rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    const row = role.rows[0];
    if (
      !row ||
      row.current_user !== RUNTIME_ROLE ||
      [row.rolsuper, row.rolcreatedb, row.rolcreaterole, row.rolreplication, row.rolbypassrls].some(Boolean)
    )
      throw new Error("Production runtime role privilege contract failed");
    const owned = await db.query(
      "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LIMIT 1",
    );
    if (owned.rowCount)
      throw new Error("Production runtime role must not own application tables");
    const migrations = await db.query(
      'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    if (!migrations.rows[0]?.count)
      throw new Error("Production runtime role cannot read migration history");
    const id = randomUUID();
    await db.query("BEGIN");
    try {
      await db.query(
        'INSERT INTO "RuntimeHeartbeat" ("id","kind","pid","state","lastSeen","startedAt") VALUES ($1,$2,$3,\'RUNNING\',NOW(),NOW())',
        [id, "bootstrap-check", process.pid],
      );
      await db.query('DELETE FROM "RuntimeHeartbeat" WHERE "id"=$1', [id]);
    } finally {
      await db.query("ROLLBACK");
    }
  } finally {
    await db.end().catch(() => {});
  }
}
