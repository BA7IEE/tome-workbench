import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { DistributionRequest, MachineDistribution } from "../auth/auth";
import { uuid } from "../common/domain";
import { DistributionService } from "./distribution.service";

@ApiTags("分发 Agent")
@MachineDistribution()
@Controller("api/distribution-agent")
export class DistributionAgentController {
  constructor(private distribution: DistributionService) {}

  @Get("protocol")
  protocol(@Req() request: DistributionRequest) {
    return this.distribution.agentProtocol(request.distributionSession);
  }

  @Get("attempts")
  attempts(@Req() request: DistributionRequest) {
    return this.distribution.agentAttempts(request.distributionSession);
  }

  @Post("attempts/:id/claim")
  claim(@Param("id") id: string, @Req() request: DistributionRequest) {
    return this.distribution.claim(request.distributionSession, uuid.parse(id));
  }

  @Get("attempts/:id/payload")
  payload(@Param("id") id: string, @Req() request: DistributionRequest) {
    return this.distribution.agentPayload(
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
    return this.distribution.agentResult(
      request.distributionSession,
      uuid.parse(id),
      raw,
    );
  }
}
