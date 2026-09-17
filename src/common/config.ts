import "dotenv/config";
import { resolve } from "node:path";
export function config() {
  const env = process.env.APP_ENV || "development";
  if (!["development", "test", "production"].includes(env))
    throw new Error("Invalid APP_ENV");
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const origin = process.env.APP_ORIGIN || "http://127.0.0.1:4318";
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:/.test(url))
    throw new Error("DATABASE_URL 必须指向独立的 PostgreSQL 库");
  const db = new URL(url);
  if (/srvf|rescue|u-nest|app_test/i.test(db.pathname))
    throw new Error("禁止连接 SRVF 或共享旧项目数据库");
  if (!/^\/tome_[a-z0-9_]+$/.test(db.pathname))
    throw new Error("数据库名必须以 tome_ 开头");
  if (process.env.EXTERNAL_EFFECTS_ENABLED === "true")
    throw new Error(
      "本版无真实渠道/支付适配器，禁止开启 EXTERNAL_EFFECTS_ENABLED",
    );
  const distributionHandoffStaleHours = Number(
    process.env.DISTRIBUTION_HANDOFF_STALE_HOURS || 24,
  );
  if (
    !Number.isInteger(distributionHandoffStaleHours) ||
    distributionHandoffStaleHours < 1 ||
    distributionHandoffStaleHours > 168
  )
    throw new Error("DISTRIBUTION_HANDOFF_STALE_HOURS 必须是 1—168 的整数");
  const secure = process.env.COOKIE_SECURE === "true";
  if (env === "production" && (!secure || !origin.startsWith("https://")))
    throw new Error("生产需要 HTTPS 与安全 Cookie");
  if (new URL(origin).origin !== origin)
    throw new Error("APP_ORIGIN 必须是无路径的精确 origin");
  return {
    env,
    origin,
    secure,
    cookie: secure ? "__Host-tome_session" : "tome_session",
    host: process.env.HOST || "127.0.0.1",
    port,
    mediaDir: resolve(process.env.MEDIA_DIR || "./data/media"),
    distributionCompatRuntimeEnabled:
      process.env.DISTRIBUTION_COMPAT_RUNTIME_ENABLED === "true",
    distributionHandoffStaleHours,
  };
}
