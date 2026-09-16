import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import {
  Access,
  Actor,
  AuthRequest,
  Public,
  actorOf,
  capabilitiesFor,
  digest,
  passwordHashAsync,
  passwordMatchesAsync,
} from "./auth";
import { config } from "../common/config";
import { Fault } from "../common/errors";
import { audit, lock } from "../common/transaction";
@ApiTags("账户")
@Controller("api/auth")
export class AuthController {
  constructor(private db: PrismaService) {}
  @Public()
  @Post("login")
  async login(
    @Body() raw: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const b = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(128),
      })
      .strict()
      .parse(raw);
    const email = b.email.toLowerCase(),
      key = digest(email);
    const now = new Date();
    const allowed = await this.db.$transaction(async (tx) => {
      await lock(tx, "login:global");
      const globalKey = "rate:all-login-attempts";
      const g = await tx.loginThrottle.findUnique({
        where: { key: globalKey },
      });
      if (g && g.resetAt > now && g.attempts >= 240) return false;
      await tx.loginThrottle.upsert({
        where: { key: globalKey },
        create: {
          key: globalKey,
          attempts: 1,
          resetAt: new Date(Date.now() + 60000),
        },
        update:
          !g || g.resetAt <= now
            ? { attempts: 1, resetAt: new Date(Date.now() + 60000) }
            : { attempts: { increment: 1 } },
      });
      await lock(tx, "login:" + key);
      const old = await tx.loginThrottle.findUnique({ where: { key } });
      if (old && old.resetAt > now && old.attempts >= 12) return false;
      await tx.loginThrottle.upsert({
        where: { key },
        create: { key, attempts: 1, resetAt: new Date(Date.now() + 900000) },
        update:
          !old || old.resetAt <= now
            ? { attempts: 1, resetAt: new Date(Date.now() + 900000) }
            : { attempts: { increment: 1 } },
      });
      return true;
    });
    if (!allowed)
      throw new Fault("LOGIN_THROTTLED", "尝试过多，请15分钟后重试", 429);
    const user = await this.db.user.findUnique({ where: { email } });
    const dummy = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
    if (
      !(await passwordMatchesAsync(b.password, user?.passwordHash || dummy)) ||
      !user?.active
    )
      throw new Fault("LOGIN_FAILED", "账号或密码错误", 401);
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    const cfg = config();
    await this.db.$transaction(async (tx) => {
      await lock(tx, "login:" + key);
      const current = (
        await tx.$queryRaw<
          { active: boolean; passwordHash: string }[]
        >`SELECT "active","passwordHash" FROM "User" WHERE "id"=${user.id}::uuid FOR SHARE`
      )[0];
      if (!current?.active || current.passwordHash !== user.passwordHash)
        throw new Fault("LOGIN_FAILED", "账号或密码已变化", 401);
      await tx.loginThrottle.updateMany({
        where: { key },
        data: { attempts: 0 },
      });
      await tx.session.create({
        data: {
          id: digest(token),
          userId: user.id,
          csrf,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      await audit(tx, user.id, "LOGIN", user.id, {
        client: req.get("User-Agent")?.slice(0, 80) || "unknown",
      });
    });
    res.cookie(cfg.cookie, token, {
      httpOnly: true,
      secure: cfg.secure,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600000,
    });
    return {
      user: actorOf(user),
      csrf,
      capabilities: capabilitiesFor(actorOf(user).role),
    };
  }
  @Access("read") @Get("me") me(@Req() req: AuthRequest) {
    return {
      user: req.actor,
      csrf: req.session.csrf,
      environment: config().env,
      capabilities: capabilitiesFor(req.actor.role),
    };
  }
  @Access("read") @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.session.deleteMany({ where: { id: req.session.id } });
    res.clearCookie(config().cookie, { path: "/" });
    return { ok: true };
  }
  @Access("users") @Get("users") users() {
    return this.db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
  @Access("users") @Post("users") async create(
    @Body() raw: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = z
      .object({
        email: z.string().email().max(254),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(12).max(128),
        role: z.enum(["ADMIN", "REVIEWER", "OPERATOR", "FINANCE", "VIEWER"]),
      })
      .strict()
      .parse(raw);
    const hashed = await passwordHashAsync(b.password);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "auth:administration");
      const currentActor = await tx.user.findUnique({
        where: { id: req.actor.id },
      });
      const liveSession = await tx.session.findUnique({
        where: { id: req.session.id },
      });
      if (
        !currentActor?.active ||
        currentActor.role !== "ADMIN" ||
        !liveSession ||
        liveSession.expiresAt <= new Date()
      )
        throw new Fault("FORBIDDEN", "管理员会话或权限已变化", 403);
      const u = await tx.user.create({
        data: {
          email: b.email.toLowerCase(),
          name: b.name,
          passwordHash: hashed,
          role: b.role,
        },
      });
      await audit(tx, req.actor.id, "USER_CREATED", u.id, { role: u.role });
      return actorOf(u);
    });
  }
  @Access("users") @Post("user-access") async change(
    @Body() raw: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = z
      .object({
        id: z.string().uuid(),
        active: z.boolean(),
        role: z.enum(["ADMIN", "REVIEWER", "OPERATOR", "FINANCE", "VIEWER"]),
      })
      .strict()
      .parse(raw);
    if (b.id === req.actor.id)
      throw new Fault("SELF_CHANGE_DENIED", "不能修改自己的权限或禁用自己");
    return this.db.$transaction(async (tx) => {
      await lock(tx, "auth:administration");
      const actor = await tx.user.findUnique({ where: { id: req.actor.id } });
      const session = await tx.session.findUnique({
        where: { id: req.session.id },
      });
      if (!actor?.active || actor.role !== "ADMIN" || !session)
        throw new Fault("FORBIDDEN", "管理员权限已变化", 403);
      const target = await tx.user.findUniqueOrThrow({ where: { id: b.id } });
      if (
        target.active &&
        target.role === "ADMIN" &&
        (!b.active || b.role !== "ADMIN") &&
        (await tx.user.count({ where: { active: true, role: "ADMIN" } })) <= 1
      )
        throw new Fault("LAST_ADMIN", "必须保留至少一个有效管理员");
      await tx.user.update({
        where: { id: b.id },
        data: { active: b.active, role: b.role },
      });
      await tx.session.deleteMany({ where: { userId: b.id } });
      await audit(tx, req.actor.id, "USER_ACCESS_CHANGED", b.id, {
        active: b.active,
        role: b.role,
      });
      return { ok: true };
    });
  }
  @Access("read") @Post("password") async changePassword(
    @Body() raw: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = z
      .object({
        current: z.string().max(128),
        next: z.string().min(12).max(128),
      })
      .strict()
      .parse(raw);
    const u = await this.db.user.findUniqueOrThrow({
      where: { id: req.actor.id },
    });
    if (!(await passwordMatchesAsync(b.current, u.passwordHash)))
      throw new Fault("PASSWORD_MISMATCH", "原密码不正确", 400);
    const nextHash = await passwordHashAsync(b.next);
    await this.db.$transaction(async (tx) => {
      await lock(tx, "password:" + u.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: u.id } });
      const liveSession = await tx.session.findUnique({
        where: { id: req.session.id },
      });
      if (
        !current.active ||
        current.passwordHash !== u.passwordHash ||
        !liveSession ||
        liveSession.expiresAt <= new Date()
      )
        throw new Fault(
          "PASSWORD_CHANGED",
          "密码或会话已变化，请重新登录",
          409,
        );
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: nextHash },
      });
      await tx.session.deleteMany({ where: { userId: u.id } });
      await audit(tx, u.id, "PASSWORD_CHANGED", u.id);
    });
    return { ok: true };
  }
}
export type SessionResult = { user: Actor; csrf: string };
