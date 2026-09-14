// Test fixture, never a production entrypoint. Only a parent-created IPC child may run it.
import runtimeLock from "./runtime-lock.cjs";
import testGuard from "./db-test-guard.cjs";
if (process.env.APP_ENV !== "test" || !process.send)
  throw new Error("Isolated test child required");
testGuard.guardDatabase(process.env.DATABASE_URL);
const mode = process.argv[2];
if (!["hold", "claim"].includes(mode)) throw new Error("Unknown test mode");
const release = await runtimeLock.runtime(mode === "claim" ? "worker" : "api");
let app;
if (mode === "claim") {
  const { NestFactory } = await import("@nestjs/core"),
    { AppModule } = await import("../dist/app.js"),
    { WorkerService } = await import("../dist/jobs/worker.service.js");
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const job = await app.get(WorkerService).claimNext();
  process.send({ phase: "CLAIMED", job });
} else process.send({ phase: "HELD", pid: process.pid });
const waiting = setInterval(() => {}, 1000);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(waiting);
  try {
    await app?.close();
  } finally {
    await release();
    process.disconnect?.();
  }
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
