import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
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
