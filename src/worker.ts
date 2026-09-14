import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app";
import { WorkerService } from "./jobs/worker.service";
import { config } from "./common/config";
import { createRequire } from "node:module";
import type { INestApplicationContext } from "@nestjs/common";
const runtime = (
  createRequire(__filename)("../scripts/runtime-lock.cjs") as {
    runtime: (kind: string) => Promise<
      (() => Promise<void>) & {
        heartbeat: (details?: unknown) => Promise<void>;
      }
    >;
  }
).runtime;
async function main() {
  config();
  const release = await runtime("worker");
  let app: INestApplicationContext | undefined,
    deadline: NodeJS.Timeout | undefined;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn"],
    });
    const worker = app.get(WorkerService);
    let running = true,
      lastSweep = 0;
    const stop = () => {
      if (!running) return;
      running = false;
      void release.heartbeat({ state: "DRAINING" }).catch(() => {});
      deadline = setTimeout(() => process.exit(1), 30000);
      deadline.unref();
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    process.on("disconnect", stop);
    console.log(
      "ToMe worker started; internal reconciliation only; external effects OFF",
    );
    while (running) {
      try {
        if (Date.now() - lastSweep > 5000) {
          await worker.sweep();
          lastSweep = Date.now();
        }
        if (!running) break;
        const worked = await worker.tick();
        if (!worked) await new Promise((r) => setTimeout(r, 250));
      } catch {
        console.error("worker retryable failure");
        if (running) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    try {
      await app?.close();
    } finally {
      await release();
      if (deadline) clearTimeout(deadline);
      if (process.connected) process.disconnect();
    }
  }
}
main().catch(() => {
  console.error("worker startup failed");
  process.exitCode = 1;
});
