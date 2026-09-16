import { ProcurementService } from "./procurement/procurement.service";
import { CostingController } from "./costing/costing.controller";
import { CostingService } from "./costing/costing.service";
import {
  IngestAdminController,
  IngestMachineController,
} from "./ingest/ingest.controller";
import { IngestMcpController } from "./ingest/ingest-mcp.controller";
import { IngestService } from "./ingest/ingest.service";
import { ProcurementController } from "./procurement/procurement.controller";
import { StudioController } from "./publishing/studio.controller";
import { TestDataController } from "./catalog/test-data.controller";
import { LogsController } from "./operations/logs.controller";
import { DictionaryInitializer } from "./dictionaries/dictionary-initializer";
import { DictionaryController } from "./dictionaries/dictionary.controller";
import { TrashController } from "./catalog/trash.controller";
import { MediaActionsController } from "./media/actions.controller";
import { PublishingDraftsController } from "./publishing/drafts.controller";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module";
import { Commands } from "./common/transaction";
import { AuthGuard } from "./auth/auth";
import { AuthController } from "./auth/auth.controller";
import { CatalogService } from "./catalog/catalog.service";
import { CatalogController } from "./catalog/catalog.controller";
import { MaterialsController } from "./catalog/materials.controller";
import { CatalogExtensionsController } from "./catalog/extensions.controller";
import { SupplyController } from "./supply/supply.controller";
import { MediaController } from "./media/media.controller";
import { IntakeController } from "./media/intake.controller";
import { PublishingService } from "./publishing/publishing.service";
import { PublishingController } from "./publishing/publishing.controller";
import { CollectionsController } from "./publishing/collections.controller";
import { TradingService } from "./trading/trading.service";
import { TradingController } from "./trading/trading.controller";
import { CostsController } from "./trading/costs.controller";
import { SettlementService } from "./trading/settlement.service";
import { SettlementController } from "./trading/settlement.controller";
import { WorkerService } from "./jobs/worker.service";
import { JobsController } from "./jobs/jobs.controller";
import { AiController } from "./ai/ai.controller";
import { SystemController } from "./system.controller";
import { RequestMonitor } from "./operations/request-monitor";
import { OperationsController } from "./operations/operations.controller";
import { DistributionService } from "./distribution/distribution.service";
import { DistributionController } from "./distribution/distribution.controller";
import { DistributionAgentController } from "./distribution/distribution-agent.controller";
@Module({
  imports: [DatabaseModule],
  providers: [
    ProcurementService,
    CostingService,
    IngestService,
    DictionaryInitializer,
    RequestMonitor,
    Commands,
    CatalogService,
    PublishingService,
    DistributionService,
    TradingService,
    SettlementService,
    WorkerService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  controllers: [
    CostingController,
    IngestAdminController,
    IngestMachineController,
    IngestMcpController,
    ProcurementController,
    StudioController,
    TestDataController,
    LogsController,
    DictionaryController,
    TrashController,
    MediaActionsController,
    PublishingDraftsController,
    OperationsController,
    IntakeController,
    CatalogExtensionsController,
    CollectionsController,
    SettlementController,
    CostsController,
    AuthController,
    CatalogController,
    MaterialsController,
    SupplyController,
    MediaController,
    PublishingController,
    DistributionController,
    DistributionAgentController,
    TradingController,
    JobsController,
    AiController,
    SystemController,
  ],
})
export class AppModule {}
