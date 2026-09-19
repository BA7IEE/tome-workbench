import { APP_VERSION } from "./version";
import { authorizationContext } from "./auth/request-context";
import { mkdir } from "node:fs/promises";
import { RequestMonitor } from "./operations/request-monitor";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { join } from "node:path";
import { AppModule } from "./app";
import { config } from "./common/config";
import { ErrorFilter } from "./common/errors";
import { setOpenApi } from "./system.controller";
export async function createApp() {
  const cfg = config();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  await mkdir(cfg.mediaDir, { recursive: true });
  app.use(
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => authorizationContext.run({}, next),
  );
  app.use(app.get(RequestMonitor).middleware);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "blob:", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: cfg.secure ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.useGlobalFilters(new ErrorFilter());
  // Entrypoint drains HTTP before closing database resources.
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use(
    "/assets",
    express.static(join(__dirname, "web/assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  const indexFile = join(__dirname, "web/index.html");
  // sendFile otherwise treats a hidden parent directory (for example a
  // managed .codex worktree) as a dotfile and rejects this fixed entrypoint.
  // The path is not derived from request input and does not expose a directory.
  server.get("/", (_req, res) =>
    res.sendFile(indexFile, { dotfiles: "allow" }),
  );
  server.get("/showroom", (_req, res) =>
    res.sendFile(indexFile, { dotfiles: "allow" }),
  );
  setOpenApi(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("ToMeBoutique Workbench API")
        .setVersion(APP_VERSION)
        .addCookieAuth(config().cookie)
        .build(),
    ),
  );
  await app.init();
  return app;
}
