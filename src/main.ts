import { createApp } from "./bootstrap";
import { config } from "./common/config";
import { RequestMonitor } from "./operations/request-monitor";
import { createRequire } from "node:module";
import type { Server } from "node:http";
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
  const c = config(),
    release = await runtime("api");
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp();
    const current = app,
      monitor = current.get(RequestMonitor),
      server = current.getHttpServer() as Server;
    server.requestTimeout = 35000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    await current.listen(c.port, c.host);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      monitor.draining = true;
      await release.heartbeat({ state: "DRAINING" }).catch(() => {});
      const deadline = setTimeout(() => {
        server.closeAllConnections();
        process.exit(1);
      }, 20000);
      deadline.unref();
      try {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        });
        await current.close();
      } finally {
        await release();
        clearTimeout(deadline);
        if (process.connected) process.disconnect();
      }
    };
    process.on(
      "SIGTERM",
      () =>
        void stop().catch(() => {
          process.exitCode = 1;
        }),
    );
    process.on(
      "SIGINT",
      () =>
        void stop().catch(() => {
          process.exitCode = 1;
        }),
    );
    process.on(
      "disconnect",
      () =>
        void stop().catch(() => {
          process.exitCode = 1;
        }),
    );
    console.log(
      `ToMeBoutique API ${c.origin}; instance=${process.pid}; external effects OFF`,
    );
  } catch (e) {
    await app?.close().catch(() => {});
    await release();
    throw e;
  }
}
main().catch(() => {
  console.error("API startup failed; inspect configuration and readiness");
  process.exitCode = 1;
});
