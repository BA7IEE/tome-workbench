import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
const kind = process.argv[2] || "api";
try {
  if (kind === "api") {
    const r = await fetch(
      `http://127.0.0.1:${process.env.PORT || 4318}/api/system/ready`,
      { signal: AbortSignal.timeout(2500) },
    );
    await r.arrayBuffer();
    if (!r.ok) throw new Error("API not ready");
  } else if (kind === "worker") {
    const dir = path.resolve(process.env.RUNTIME_DIR || "data/run");
    const files = fs
      .readdirSync(dir)
      .filter((n) => /-worker-.*\.json$/.test(n));
    const ids = [];
    for (const f of files) {
      const row = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      try {
        process.kill(row.pid, 0);
        ids.push(row.id);
      } catch {}
    }
    if (!ids.length) throw new Error("No local worker process");
    const db = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    });
    try {
      await db.connect();
      const r = await db.query(
        'SELECT 1 FROM "RuntimeHeartbeat" WHERE "id"=ANY($1::uuid[]) AND "state"=\'RUNNING\' AND "lastSeen">NOW()-INTERVAL \'20 seconds\' LIMIT 1',
        [ids],
      );
      if (!r.rowCount) throw new Error("Worker heartbeat expired");
    } finally {
      await db.end().catch(() => {});
    }
  } else throw new Error("Unknown probe");
} catch {
  console.error("NOT_READY");
  process.exitCode = 1;
}
