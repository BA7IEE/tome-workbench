import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
const raw = new URL(process.env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1", "postgres"].includes(raw.hostname) ||
  !/^\/tome_/.test(raw.pathname)
)
  throw new Error("Only local isolated ToMe databases");
raw.pathname = "/postgres";
const db = new PrismaClient({ datasources: { db: { url: raw.toString() } } });
try {
  const rows =
    await db.$queryRaw`SELECT datname FROM pg_database WHERE datname='tome_test'`;
  if (rows.length === 0)
    await db.$executeRawUnsafe("CREATE DATABASE tome_test");
} finally {
  await db.$disconnect();
}
raw.pathname = "/tome_test";
const p = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "deploy"],
  { env: { ...process.env, DATABASE_URL: raw.toString() }, stdio: "inherit" },
);
process.exitCode = p.status || 0;
