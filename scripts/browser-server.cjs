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
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(
    "reports/browser-server.json",
    JSON.stringify({ pid: process.pid }),
  );
  // Test-only transport observations around the unchanged application entrypoint.
  const bootstrap = require("../dist/bootstrap.js");
  const createApp = bootstrap.createApp;
  bootstrap.createApp = async (...args) => {
    const app = await createApp(...args);
    app.getHttpServer().prependListener("request", (req, res) => {
      if (req.method !== "POST" || req.url !== "/api/auth/login") return;
      const started = Date.now();
      const write = (event) =>
        fs.appendFileSync(
          "reports/browser-login-server.jsonl",
          JSON.stringify({
            event,
            requestAt: new Date(started).toISOString(),
            elapsedMs: Date.now() - started,
            status: res.statusCode,
          }) + "\n",
        );
      write("received");
      res.once("finish", () => write("finished"));
      res.once("close", () => write("closed"));
    });
    return app;
  };
  require("../dist/main.js");
}
start().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
