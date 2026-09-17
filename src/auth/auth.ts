import { scrypt as nodeScrypt } from "node:crypto";
import { authorizationContext } from "./request-context";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.service";
import { config } from "../common/config";
import { Fault } from "../common/errors";
export type Role = "ADMIN" | "REVIEWER" | "OPERATOR" | "FINANCE" | "VIEWER";
export type Actor = { id: string; name: string; email: string; role: Role };
export type AuthRequest = Request & {
  actor: Actor;
  session: { id: string; csrf: string };
};
export type IngestRequest = Request & {
  ingestSession: { id:string; createdBy:string; procurementSourceId:string };
};
export type DistributionRequest = Request & {
  distributionSession: {
    id: string;
    createdBy: string;
    channelId: string;
    agentName: string;
  };
};
const grants: Record<Role, string[]> = {
  ADMIN: [
    "dictionary",
    "read",
    "edit",
    "delete",
    "review",
    "publish",
    "sell",
    "finance",
    "supply",
    "users",
    "audit",
    "export",
  ],
  REVIEWER: ["read", "edit", "delete", "review", "publish", "sell"],
  OPERATOR: ["read", "edit", "delete", "publish", "sell"],
  FINANCE: ["read", "finance", "supply", "sell", "audit", "export"],
  VIEWER: ["read"],
};
export const capabilitiesFor = (role: Role): string[] => [...(grants[role] || [])];
export const permission = (role: Role, action: string) =>
  grants[role]?.includes(action) === true;
export const Access = (action: string) => SetMetadata("access", action);
export const Public = () => SetMetadata("public", true);
export const MachineIngest = () => SetMetadata("machineIngest", true);
export const MachineDistribution = () =>
  SetMetadata("machineDistribution", true);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password: string, value: string) {
  try {
    const [, salt, h] = value.split(":");
    const expected = Buffer.from(h, "hex"),
      actual = scryptSync(password, salt, 64);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}
export const actorOf = (u: {
  id: string;
  name: string;
  email: string;
  role: string;
}): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role as Role });
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private db: PrismaService,
    private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<AuthRequest & IngestRequest & DistributionRequest>();
    const cfg = config();
    const machine = this.reflector.getAllAndOverride<boolean>("machineIngest", [ctx.getHandler(),ctx.getClass()]);
    if(machine){
      const directToken=req.get("X-Ingest-Token") || "";
      const bearer=/^Bearer\s+([a-f0-9]{64})$/.exec(req.get("Authorization") || "")?.[1] || "";
      const token=directToken || bearer;
      if(!/^[a-f0-9]{64}$/.test(token)) throw new Fault("INGEST_TOKEN_REQUIRED","缺少有效导入令牌",401);
      const session=await this.db.ingestSession.findUnique({where:{tokenHash:digest(token)}});
      if(!session || session.revokedAt || session.expiresAt<=new Date()) throw new Fault("INGEST_SESSION_EXPIRED","导入会话不存在、已撤销或已过期",401);
      req.ingestSession={id:session.id,createdBy:session.createdBy,procurementSourceId:session.procurementSourceId};
      return true;
    }
    const distribution = this.reflector.getAllAndOverride<boolean>(
      "machineDistribution",
      [ctx.getHandler(), ctx.getClass()],
    );
    if (distribution) {
      const token = req.get("X-Distribution-Token") || "";
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Fault("DISTRIBUTION_TOKEN_REQUIRED", "缺少有效分发令牌", 401);
      const now = new Date();
      const session = await this.db.distributionSession.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (!session || session.revokedAt || session.expiresAt <= now)
        throw new Fault(
          "DISTRIBUTION_SESSION_EXPIRED",
          "分发会话不存在、已撤销或已过期",
          401,
        );
      // A machine credential delegates its creator's publish authority; it is
      // not an independent role. Keep this check here for every read as well
      // as in the write receipt transaction, so removing the creator's access
      // immediately stops both the standard handoff surface and compatibility
      // endpoints.
      const creator = await this.db.user.findUnique({
        where: { id: session.createdBy },
        select: { active: true, role: true },
      });
      if (!creator?.active || !permission(creator.role as Role, "publish"))
        throw new Fault(
          "DISTRIBUTION_CREATOR_REVOKED",
          "分发会话创建者已失去发布权限",
          403,
        );
      const used = await this.db.distributionSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { lastUsedAt: now },
      });
      if (used.count !== 1)
        throw new Fault(
          "DISTRIBUTION_SESSION_EXPIRED",
          "分发会话不存在、已撤销或已过期",
          401,
        );
      req.distributionSession = {
        id: session.id,
        createdBy: session.createdBy,
        channelId: session.channelId,
        agentName: session.agentName,
      };
      return true;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("Origin") !== cfg.origin)
        throw new Fault("ORIGIN_DENIED", "请求来源不匹配", 403);
    }
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const cookie = req.cookies?.[cfg.cookie];
    if (typeof cookie !== "string" || cookie.length !== 64)
      throw new Fault("LOGIN_REQUIRED", "请先登录", 401);
    const s = await this.db.session.findUnique({
      where: { id: digest(cookie) },
      include: { user: true },
    });
    if (!s || s.expiresAt <= new Date() || !s.user.active)
      throw new Fault("SESSION_EXPIRED", "登录已过期", 401);
    req.actor = actorOf(s.user);
    req.session = { id: s.id, csrf: s.csrf };
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-CSRF-Token") !== s.csrf
    )
      throw new Fault("CSRF_DENIED", "请求校验失败，请刷新", 403);
    const action = this.reflector.getAllAndOverride<string>("access", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!action || !permission(req.actor.role, action))
      throw new Fault("FORBIDDEN", "没有此操作权限", 403);
    const scope = authorizationContext.getStore();
    if (!scope)
      throw new Fault("AUTH_CONTEXT_MISSING", "请求上下文不可用", 503);
    Object.assign(scope, { actorId: req.actor.id, action, sessionId: s.id });
    return true;
  }
}

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    nodeScrypt(password, salt, 64, (e, key) => (e ? reject(e) : resolve(key))),
  );
export async function passwordHashAsync(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function passwordMatchesAsync(password: string, value: string) {
  try {
    const [, salt, h] = value.split(":");
    const expected = Buffer.from(h, "hex"),
      actual = await derive(password, salt);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}
