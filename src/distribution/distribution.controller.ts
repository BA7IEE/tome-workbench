import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { Access, AuthRequest } from "../auth/auth";
import { uuid } from "../common/domain";
import { DistributionService } from "./distribution.service";

@ApiTags("商品分发")
@Controller("api/distribution")
export class DistributionController {
  constructor(private distribution: DistributionService) {}

  @Access("users")
  @Post("sessions")
  createSession(@Body() raw: unknown, @Req() request: AuthRequest) {
    return this.distribution.createSession(
      request.actor,
      request.get("Idempotency-Key"),
      raw,
    );
  }

  @Access("users")
  @Get("sessions")
  sessions(@Query("channelId") channelId?: string) {
    return this.distribution.sessions(channelId ? uuid.parse(channelId) : undefined);
  }

  @Access("users")
  @Post("sessions/:id/revoke")
  revokeSession(@Param("id") id: string, @Req() request: AuthRequest) {
    return this.distribution.revokeSession(
      request.actor,
      request.get("Idempotency-Key"),
      uuid.parse(id),
    );
  }

  @Access("publish")
  @Post("plan")
  plan(@Body() raw: unknown, @Req() request: AuthRequest) {
    return this.distribution.plan(
      request.actor,
      request.get("Idempotency-Key"),
      raw,
    );
  }

  @Access("publish")
  @Get("summary")
  summary(@Query("channelId") channelId?: string) {
    return this.distribution.summary(channelId ? uuid.parse(channelId) : undefined);
  }

  @Access("publish")
  @ApiQuery({
    name: "page",
    required: false,
    description: "页码，最小为 1",
    schema: { type: "integer", minimum: 1, default: 1 },
  })
  @ApiQuery({
    name: "size",
    required: false,
    description: "每页项目数，1—100",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: "channelId",
    required: false,
    description: "按渠道账号筛选",
    schema: { type: "string", format: "uuid" },
  })
  @ApiQuery({
    name: "state",
    required: false,
    description: "按单一经营状态筛选，不能与 scope 同时传入",
    schema: {
      type: "string",
      enum: [
        "READY",
        "BLOCKED",
        "PENDING",
        "HANDED_OFF",
        "PUBLISHED",
        "NEEDS_UPDATE",
        "ATTENTION",
        "NEEDS_STOP",
        "CANCELLED",
      ],
    },
  })
  @ApiQuery({
    name: "scope",
    required: false,
    description: "经营视图范围，默认 all",
    schema: {
      type: "string",
      enum: [
        "all",
        "unpublished",
        "ready",
        "blocked",
        "pending",
        "handed-off",
        "published",
        "needs-update",
        "attention",
        "needs-stop",
        "cancelled",
      ],
      default: "all",
    },
  })
  @ApiQuery({
    name: "brand",
    required: false,
    description: "按品牌文本筛选",
    schema: { type: "string", maxLength: 100 },
  })
  @ApiQuery({
    name: "q",
    required: false,
    description: "按永久 TM、商品名称或品牌搜索",
    schema: { type: "string", maxLength: 200 },
  })
  @ApiQuery({
    name: "attemptId",
    required: false,
    description: "定位一条原分发记录；会锁定其商品与渠道",
    schema: { type: "string", format: "uuid" },
  })
  @Get("operations")
  operations(@Query() raw: unknown) {
    return this.distribution.operations(raw);
  }

  @Access("publish")
  @Get("attempts")
  attempts(@Query() raw: unknown) {
    return this.distribution.attempts(raw);
  }

  @Access("publish")
  @Post("attempts/:id/retry")
  retry(@Param("id") id: string, @Req() request: AuthRequest) {
    return this.distribution.retry(
      request.actor,
      request.get("Idempotency-Key"),
      uuid.parse(id),
    );
  }

  @Access("publish")
  @Post("attempts/:id/manual-result")
  manualResult(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.distribution.manualResult(
      request.actor,
      request.get("Idempotency-Key"),
      uuid.parse(id),
      raw,
    );
  }
}
