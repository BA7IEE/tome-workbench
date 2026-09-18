import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { DistributionRequest, MachineDistribution } from "../auth/auth";
import { config } from "../common/config";
import { uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { DistributionService } from "./distribution.service";

@ApiTags("分发 Agent")
@MachineDistribution()
@Controller("api/distribution-agent")
export class DistributionAgentController {
  constructor(private distribution: DistributionService) {}

  private requireCompatRuntime() {
    if (!config().distributionCompatRuntimeEnabled)
      throw new Fault(
        "COMPAT_DISTRIBUTION_RUNTIME_DISABLED",
        "旧版领取/租约分发接口默认关闭；请使用标准 Handoff MCP 或显式启用兼容运行时",
        410,
      );
  }

  // Standard delivery surface: a package is handed to an external executor;
  // ToMe never receives platform selectors, credentials or click steps.
  @Get("handoffs")
  handoffs(@Req() request: DistributionRequest) {
    return this.distribution.handoffs(request.distributionSession);
  }

  @Post("handoffs/:id/package")
  handoffPackage(@Param("id") id: string, @Req() request: DistributionRequest) {
    return this.distribution.handoffPackage(
      request.distributionSession,
      request.get("Idempotency-Key"),
      uuid.parse(id),
    );
  }

  @Get("handoffs/:id/assets/:assetId")
  async handoffAsset(
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Req() request: DistributionRequest,
    @Res() response: Response,
  ) {
    const asset = await this.distribution.handoffAsset(
      request.distributionSession,
      uuid.parse(id),
      uuid.parse(assetId),
    );
    response
      .set({
        "Content-Type": asset.mime,
        "Content-Disposition": `attachment; filename="${asset.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(asset.bytes);
  }

  @Post("handoffs/:id/published")
  handoffPublished(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: DistributionRequest,
  ) {
    return this.distribution.reportHandoffPublished(
      request.distributionSession,
      request.get("Idempotency-Key"),
      uuid.parse(id),
      raw,
    );
  }

  @Post("handoffs/:id/attention")
  handoffAttention(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: DistributionRequest,
  ) {
    return this.distribution.reportHandoffAttention(
      request.distributionSession,
      request.get("Idempotency-Key"),
      uuid.parse(id),
      raw,
    );
  }

  // Advanced runtime-compatible endpoints remain intentionally separate from
  // the default handoff contract above.
  @Get("protocol")
  protocol(@Req() request: DistributionRequest) {
    return this.distribution.agentProtocol(request.distributionSession);
  }

  @Get("skill")
  async skill(@Res() response: Response) {
    const skill = await this.distribution.machineHandoffSkillDocument();
    response
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(skill.markdown);
  }

  @Get("profile")
  async profile(
    @Req() request: DistributionRequest,
    @Res() response: Response,
  ) {
    const profile = await this.distribution.machineHandoffProfileDocument(
      request.distributionSession,
    );
    response
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(profile.markdown);
  }

  @Get("attempts")
  attempts(@Req() request: DistributionRequest) {
    this.requireCompatRuntime();
    return this.distribution.agentAttempts(request.distributionSession);
  }

  @Post("attempts/:id/claim")
  claim(@Param("id") id: string, @Req() request: DistributionRequest) {
    this.requireCompatRuntime();
    return this.distribution.claim(request.distributionSession, uuid.parse(id));
  }

  @Get("attempts/:id/payload")
  payload(@Param("id") id: string, @Req() request: DistributionRequest) {
    this.requireCompatRuntime();
    return this.distribution.agentPayload(
      request.distributionSession,
      uuid.parse(id),
    );
  }

  @Get("attempts/:id/anqicms-spike")
  anqicmsSpike(
    @Param("id") id: string,
    @Req() request: DistributionRequest,
  ) {
    this.requireCompatRuntime();
    return this.distribution.agentAnqicmsSpikePayload(
      request.distributionSession,
      uuid.parse(id),
    );
  }

  @Get("attempts/:id/assets/:assetId")
  async asset(
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Req() request: DistributionRequest,
    @Res() response: Response,
  ) {
    this.requireCompatRuntime();
    const asset = await this.distribution.agentAsset(
      request.distributionSession,
      uuid.parse(id),
      uuid.parse(assetId),
    );
    response
      .set({
        "Content-Type": asset.mime,
        "Content-Disposition": `attachment; filename="${asset.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(asset.bytes);
  }

  @Post("attempts/:id/result")
  result(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: DistributionRequest,
  ) {
    this.requireCompatRuntime();
    return this.distribution.agentResult(
      request.distributionSession,
      uuid.parse(id),
      raw,
    );
  }
}
