import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
export class Fault extends HttpException {
  constructor(code: string, message: string, status = 409) {
    super({ code, message }, status);
  }
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = String(res.locals.requestId || randomUUID());
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "操作失败，请保留请求编号联系管理员";
    if (error instanceof Fault) {
      status = error.getStatus();
      const d = error.getResponse() as { code: string; message: string };
      code = d.code;
      message = d.message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = "INVALID_INPUT";
      message = error.issues
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .slice(0, 6)
        .join("；");
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P2002", "P2003", "P2034", "P2025"].includes(error.code)) {
        status = 409;
        code = "DATA_CONFLICT";
        message = "记录冲突、关联不匹配或记录不存在，请刷新后核对";
      }
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = "HTTP_ERROR";
      message =
        typeof error.getResponse() === "string"
          ? String(error.getResponse())
          : error.message;
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          requestId,
          kind: error instanceof Error ? error.constructor.name : "unknown",
        }),
      );
    res.status(status).json({ error: { code, message, requestId } });
  }
}
