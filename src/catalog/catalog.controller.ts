import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { catalogQuery } from "./catalog-query";
import { Access, AuthRequest } from "../auth/auth";
import { uuid } from "../common/domain";
import { CatalogService } from "./catalog.service";
@ApiTags("商品")
@Controller("api/items")
export class CatalogController {
  constructor(private service: CatalogService) {}
  @Access("read") @Get() list(@Query() raw: unknown, @Req() r: AuthRequest) {
    const query = catalogQuery.parse(raw);
    return this.service.list(query.q, query.status, query.page, query, r.actor);
  }
  @Access("read") @Get(":id") get(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    return this.service.detail(uuid.parse(id), r.actor);
  }
  @Access("edit") @Post() create(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.service.create(r.actor, r.get("Idempotency-Key"), b);
  }
  @Access("edit") @Patch(":id") update(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.update(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("review") @Post(":id/approve") approve(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.approve(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("edit") @Post(":id/move") move(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.move(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
}
