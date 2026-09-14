import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Access, AuthRequest } from "../auth/auth";
import { uuid } from "../common/domain";
import { CostingService } from "./costing.service";
import {
  commitOrderCostInput,
  orderCostBasisInput,
  sourceCostPolicyInput,
} from "./costing.schemas";

@ApiTags("商品取得成本")
@Access("finance")
@Controller("api/costing")
export class CostingController {
  constructor(private service: CostingService) {}
  @Post("sources/:id/policy") policy(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.setSourcePolicy(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      sourceCostPolicyInput.parse(raw),
    );
  }
  @Get("orders/:id/preview") preview(@Param("id") id: string) {
    return this.service.preview(uuid.parse(id));
  }
  @Post("orders/:id/basis") basis(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.setOrderBasis(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      orderCostBasisInput.parse(raw),
    );
  }
  @Post("orders/:id/commit") commit(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = commitOrderCostInput.parse(raw);
    return this.service.commit(
      r.actor,
      r.get("Idempotency-Key"),
      uuid.parse(id),
      b.basisVersion,
    );
  }
}
