const fs = require("node:fs");
const { guardDatabase } = require("./db-test-guard.cjs");
const f = JSON.parse(fs.readFileSync("data/browser-fixture.json", "utf8"));
guardDatabase(f.databaseUrl);
Object.assign(process.env, {
  DATABASE_URL: f.databaseUrl,
  APP_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "4320",
  APP_ORIGIN: "http://127.0.0.1:4320",
  MEDIA_DIR: "./data/test-media",
  COOKIE_SECURE: "false",
  EXTERNAL_EFFECTS_ENABLED: "false",
});
// Reset only isolated test throttles so repeated browser suites are reproducible.
// The real HTTP authentication and throttling implementation remains enabled.
async function start() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    await db.loginThrottle.deleteMany();
  } finally {
    await db.$disconnect();
  }
  require("../dist/main.js");
}
start().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
