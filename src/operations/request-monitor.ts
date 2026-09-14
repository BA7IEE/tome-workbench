import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
@Injectable()
export class RequestMonitor {
  draining = false;
  private active = 0;
  private total = 0;
  private failures = 0;
  private samples: number[] = [];
  readonly startedAt = new Date();
  middleware = (req: Request, res: Response, next: NextFunction) => {
    const started = performance.now();
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    if (process.env.APP_ENV === "test")
      res.setHeader("X-ToMe-Instance", String(process.pid));
    this.active++;
    this.total++;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.active--;
      if (res.statusCode >= 500) this.failures++;
      this.samples.push(performance.now() - started);
      if (this.samples.length > 512) this.samples.shift();
    };
    res.once("finish", finish);
    res.once("close", finish);
    if (this.draining && req.path !== "/api/system/health") {
      res.setHeader("Retry-After", "2");
      res.status(503).json({
        error: {
          code: "DRAINING",
          message: "服务正在切换，请稍后重试",
          requestId,
        },
      });
      return;
    }
    next();
  };
  snapshot() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      startedAt: this.startedAt,
      draining: this.draining,
      inFlight: this.active,
      requests: this.total,
      serverErrors: this.failures,
      last512P95Ms: sorted.length
        ? Math.round(
            sorted[
              Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
            ],
          )
        : null,
    };
  }
}
