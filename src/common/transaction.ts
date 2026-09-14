import { authorizationContext } from "../auth/request-context";
import { permission, type Role } from "../auth/auth";
// Adapted from SRVF integration-idempotency.service.ts at d8bf3ee6; see docs/PROVENANCE.md.
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { Fault } from "./errors";
export type Tx = Prisma.TransactionClient;
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v))
      throw new Fault("INVALID_NUMBER", "非有限数值", 400);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object")
    return (
      "{" +
      Object.keys(v as object)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((v as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  throw new Fault("INVALID_JSON", "请求必须可序列化", 400);
}
export function hash(v: unknown) {
  return createHash("sha256").update(canonical(v)).digest("hex");
}
export function json(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
export async function lock(tx: Tx, key: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text,0))`,
  );
}
export async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  resourceId: string,
  detail: unknown = {},
) {
  await tx.audit.create({
    data: { actorId, action, resourceId, detail: json(detail) },
  });
}
export async function event(
  tx: Tx,
  itemId: string,
  kind = "ITEM_CHANGED",
  payload: unknown = {},
) {
  await tx.outbox.create({ data: { itemId, kind, payload: json(payload) } });
}
@Injectable()
export class Commands {
  constructor(private readonly db: PrismaService) {}
  async run<T extends Record<string, unknown>>(
    actorId: string,
    operation: string,
    key: unknown,
    input: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{12,128}$/.test(key))
      throw new Fault("IDEMPOTENCY_REQUIRED", "写操作需要12—128位幂等键", 400);
    const requestHash = hash(input);
    return this.db.$transaction(
      async (tx) => {
        // Order: shared accounting boundary, command receipt, item. No external effects occur here.
        if (
          /^(settlement\.|sale\.|observation\.|item\.(sold|state|reserve|release|trash|restore|testCleanup)$)/.test(
            operation,
          )
        )
          await lock(tx, "financial-journal");
        await lock(tx, `cmd:${actorId}:${operation}:${key}`);
        const ctx = authorizationContext.getStore();
        if (!ctx?.action || ctx.actorId !== actorId || !ctx.sessionId)
          throw new Fault("AUTH_CONTEXT_REQUIRED", "缺少受控写入上下文", 403);
        const users = await tx.$queryRaw<
          { active: boolean; role: string }[]
        >`SELECT "active","role" FROM "User" WHERE "id"=${actorId}::uuid FOR SHARE`;
        const account = users[0];
        const session = await tx.session.findUnique({
          where: { id: ctx.sessionId },
        });
        if (
          !account?.active ||
          !permission(account.role as Role, ctx.action) ||
          !session ||
          session.userId !== actorId ||
          session.expiresAt <= new Date()
        )
          throw new Fault(
            "ACCOUNT_REVOKED",
            "权限或会话已变化，请重新登录",
            403,
          );
        const old = await tx.receipt.findUnique({
          where: { actorId_operation_key: { actorId, operation, key } },
        });
        if (old) {
          if (old.requestHash !== requestHash)
            throw new Fault("IDEMPOTENCY_CONFLICT", "相同幂等键对应不同内容");
          return old.response as T;
        }
        const result = await fn(tx);
        await tx.receipt.create({
          data: {
            actorId,
            operation,
            key,
            requestHash,
            response: json(result),
          },
        });
        return result;
      },
      { maxWait: 10000, timeout: 20000 },
    );
  }
}
