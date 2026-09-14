import { APP_VERSION } from "./version";
import { Controller, Get } from "@nestjs/common";
import { access, constants, statfs } from "node:fs/promises";
import { Access, Public } from "./auth/auth";
import { PrismaService } from "./database/prisma.service";
import { config } from "./common/config";
import { Fault } from "./common/errors";
import { RequestMonitor } from "./operations/request-monitor";
import type { OpenAPIObject } from "@nestjs/swagger";
export let openapi: OpenAPIObject;
export function setOpenApi(value: OpenAPIObject) {
  openapi = value;
}
@Controller("api/system")
export class SystemController {
  constructor(
    private db: PrismaService,
    private monitor: RequestMonitor,
  ) {}
  @Public() @Get("health") health() {
    return { status: "up", version: APP_VERSION };
  }
  @Public() @Get("ready") async ready() {
    if (this.monitor.draining) throw new Fault("DRAINING", "服务正在停止", 503);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          this.db.$queryRaw`SELECT 1`,
          access(config().mediaDir, constants.R_OK | constants.W_OK),
          statfs(config().mediaDir).then((s) => {
            if (s.bavail * s.bsize < 256 * 1024 * 1024)
              throw new Error("Storage headroom insufficient");
          }),
        ]),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("timeout")), 2000);
        }),
      ]);
      return { status: "ready", database: "up", storage: "accessible" };
    } catch {
      throw new Fault("NOT_READY", "依赖暂不可用，请稍后重试", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
  @Access("read") @Get("openapi") docs() {
    return openapi;
  }
}
