-- AlterTable
ALTER TABLE "ProcurementSource" ADD COLUMN     "costAllocationMethod" TEXT NOT NULL DEFAULT 'PROPORTIONAL_LINE_AMOUNT',
ADD COLUMN     "orderOverheadCny" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "storeCreditAsPayment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CostEntry" ADD COLUMN     "sourceRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "PurchaseOrderCostBasis" (
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL,
    "cashPaidCny" INTEGER,
    "fxMicros" INTEGER,
    "foreignEconomicTotalOverride" INTEGER,
    "overheadCny" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedBy" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderCostBasis_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "PurchaseOrderCostBasisRevision" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderCostBasisRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestSession" (
    "id" UUID NOT NULL,
    "procurementSourceId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestBatch" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "procurementSourceId" UUID NOT NULL,
    "externalBatchKey" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'ITEM_BATCH',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "rawManifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),

    CONSTRAINT "IngestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestCandidate" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "procurementSourceId" UUID NOT NULL,
    "externalKey" TEXT NOT NULL,
    "sourceItemKey" TEXT NOT NULL DEFAULT '',
    "purchaseLineId" UUID,
    "sourceId" UUID,
    "itemId" UUID,
    "titleRaw" TEXT NOT NULL,
    "brandRaw" TEXT NOT NULL DEFAULT '',
    "categoryRaw" TEXT NOT NULL DEFAULT '',
    "conditionRaw" TEXT NOT NULL DEFAULT '',
    "statusRaw" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "sourceLineAmount" INTEGER,
    "sourceCurrentPrice" INTEGER,
    "sourceEstimatedRetail" INTEGER,
    "sourceFacts" JSONB NOT NULL,
    "proposal" JSONB NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "possession" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "IngestCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestCandidateRevision" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestCandidateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestCandidateAsset" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "roleHint" TEXT NOT NULL DEFAULT 'PRODUCT',
    "assetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestCandidateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSourceLink" (
    "itemId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ACQUISITION',
    "linkedBy" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ItemSourceLink_pkey" PRIMARY KEY ("itemId","sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderCostBasisRevision_orderId_version_key" ON "PurchaseOrderCostBasisRevision"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IngestSession_tokenHash_key" ON "IngestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "IngestSession_procurementSourceId_expiresAt_idx" ON "IngestSession"("procurementSourceId", "expiresAt");

-- CreateIndex
CREATE INDEX "IngestBatch_status_createdAt_idx" ON "IngestBatch"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestBatch_procurementSourceId_externalBatchKey_key" ON "IngestBatch"("procurementSourceId", "externalBatchKey");

-- CreateIndex
CREATE INDEX "IngestCandidate_decision_createdAt_idx" ON "IngestCandidate"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "IngestCandidate_batchId_decision_idx" ON "IngestCandidate"("batchId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "IngestCandidate_procurementSourceId_externalKey_key" ON "IngestCandidate"("procurementSourceId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "IngestCandidateRevision_candidateId_version_key" ON "IngestCandidateRevision"("candidateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IngestCandidateAsset_objectKey_key" ON "IngestCandidateAsset"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "IngestCandidateAsset_assetId_key" ON "IngestCandidateAsset"("assetId");

-- CreateIndex
CREATE INDEX "IngestCandidateAsset_candidateId_createdAt_idx" ON "IngestCandidateAsset"("candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestCandidateAsset_candidateId_sha256_key" ON "IngestCandidateAsset"("candidateId", "sha256");

-- CreateIndex
CREATE INDEX "ItemSourceLink_sourceId_idx" ON "ItemSourceLink"("sourceId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderCostBasis" ADD CONSTRAINT "PurchaseOrderCostBasis_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderCostBasisRevision" ADD CONSTRAINT "PurchaseOrderCostBasisRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrderCostBasis"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestSession" ADD CONSTRAINT "IngestSession_procurementSourceId_fkey" FOREIGN KEY ("procurementSourceId") REFERENCES "ProcurementSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestBatch" ADD CONSTRAINT "IngestBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IngestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestBatch" ADD CONSTRAINT "IngestBatch_procurementSourceId_fkey" FOREIGN KEY ("procurementSourceId") REFERENCES "ProcurementSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_procurementSourceId_fkey" FOREIGN KEY ("procurementSourceId") REFERENCES "ProcurementSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidateRevision" ADD CONSTRAINT "IngestCandidateRevision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "IngestCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidateAsset" ADD CONSTRAINT "IngestCandidateAsset_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "IngestCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestCandidateAsset" ADD CONSTRAINT "IngestCandidateAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSourceLink" ADD CONSTRAINT "ItemSourceLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSourceLink" ADD CONSTRAINT "ItemSourceLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- v1 item-centric safety constraints. Agent data cannot manufacture formal inventory states.
ALTER TABLE "ProcurementSource" ADD CONSTRAINT "ProcurementSource_cost_policy_valid" CHECK ("version">0 AND "orderOverheadCny">=0 AND "costAllocationMethod" IN ('PROPORTIONAL_LINE_AMOUNT'));
ALTER TABLE "PurchaseOrderCostBasis" ADD CONSTRAINT "PurchaseOrderCostBasis_valid" CHECK ("version">0 AND "mode" IN ('ACTUAL_CASH_CNY','CONFIRMED_FX','SUGGESTED_FX') AND "overheadCny">=0 AND ("cashPaidCny" IS NULL OR "cashPaidCny">=0) AND ("fxMicros" IS NULL OR "fxMicros">0) AND ("foreignEconomicTotalOverride" IS NULL OR "foreignEconomicTotalOverride">=0));
ALTER TABLE "IngestSession" ADD CONSTRAINT "IngestSession_token_hash_valid" CHECK (length("tokenHash")=64);
ALTER TABLE "IngestBatch" ADD CONSTRAINT "IngestBatch_status_valid" CHECK ("status" IN ('OPEN','SEALED'));
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_state_valid" CHECK ("decision" IN ('PENDING','CONFIRMED','EXCLUDED') AND "possession" IN ('UNKNOWN','IN_HAND','NOT_IN_HAND') AND "version">0);
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_item_confirmation_anchor" CHECK (("decision"='CONFIRMED' AND "itemId" IS NOT NULL AND "confirmedAt" IS NOT NULL) OR ("decision"<>'CONFIRMED' AND "itemId" IS NULL));
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_amounts_nonnegative" CHECK (("sourceLineAmount" IS NULL OR "sourceLineAmount">=0) AND ("sourceCurrentPrice" IS NULL OR "sourceCurrentPrice">=0) AND ("sourceEstimatedRetail" IS NULL OR "sourceEstimatedRetail">=0));
ALTER TABLE "IngestCandidateAsset" ADD CONSTRAINT "IngestCandidateAsset_role_valid" CHECK ("roleHint" IN ('PRODUCT','DETAIL','DEFECT','REFERENCE'));
ALTER TABLE "ItemSourceLink" ADD CONSTRAINT "ItemSourceLink_kind_valid" CHECK ("kind" IN ('ACQUISITION','HISTORY','REFERENCE','OTHER'));
CREATE UNIQUE INDEX "CostEntry_one_active_procurement_source" ON "CostEntry"("itemId","sourceType","sourceRef") WHERE "status"='ACTIVE' AND "sourceType"='PROCUREMENT_ORDER' AND "sourceRef"<>'';

-- Backfill legacy first-source relationships into the new many-source relation.
INSERT INTO "ItemSourceLink" ("itemId","sourceId","kind","linkedBy","linkedAt","note")
SELECT "id","sourceId",'ACQUISITION','00000000-0000-0000-0000-000000000000'::uuid,"createdAt",'v1 migration from legacy Item.sourceId'
FROM "Item" WHERE "sourceId" IS NOT NULL
ON CONFLICT ("itemId","sourceId") DO NOTHING;
