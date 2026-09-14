-- CreateTable
CREATE TABLE "RuntimeHeartbeat" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RUNNING',
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SweepLease" (
    "id" TEXT NOT NULL,
    "cursor" TEXT,
    "token" TEXT,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "SweepLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemAlias" (
    "code" TEXT NOT NULL,
    "itemId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemAlias_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RequirementWaiver" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RequirementWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeBatch" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeFile" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hint" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "note" TEXT NOT NULL DEFAULT '',
    "assetId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEntry" (
    "id" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CollectionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "agreementRef" TEXT NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" UUID NOT NULL,
    "activatedBy" UUID,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementStatement" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "baseId" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedBy" UUID,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuntimeHeartbeat_kind_lastSeen_idx" ON "RuntimeHeartbeat"("kind", "lastSeen");

-- CreateIndex
CREATE INDEX "ItemAlias_itemId_idx" ON "ItemAlias"("itemId");

-- CreateIndex
CREATE INDEX "RequirementWaiver_itemId_status_idx" ON "RequirementWaiver"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFile_objectKey_key" ON "IntakeFile"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFile_assetId_key" ON "IntakeFile"("assetId");

-- CreateIndex
CREATE INDEX "IntakeFile_batchId_state_idx" ON "IntakeFile"("batchId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEntry_collectionId_itemId_key" ON "CollectionEntry"("collectionId", "itemId");

-- CreateIndex
CREATE INDEX "SettlementStatement_currency_periodStart_periodEnd_status_idx" ON "SettlementStatement"("currency", "periodStart", "periodEnd", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementLine_statementId_saleId_key" ON "SettlementLine"("statementId", "saleId");

-- AddForeignKey
ALTER TABLE "ItemAlias" ADD CONSTRAINT "ItemAlias_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "RequirementWaiver_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFile" ADD CONSTRAINT "IntakeFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IntakeBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFile" ADD CONSTRAINT "IntakeFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_packageId_itemId_channelId_fkey" FOREIGN KEY ("packageId", "itemId", "channelId") REFERENCES "UsePackage"("id", "itemId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementStatement" ADD CONSTRAINT "SettlementStatement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "SettlementRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementStatement" ADD CONSTRAINT "SettlementStatement_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "SettlementStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "SettlementStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reviewed database invariants; original migration is not changed.
ALTER TABLE "ItemAlias" ADD CONSTRAINT "Alias_canonical_namespace" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' AND "code" !~ '^TM[0-9]+$');
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "Waiver_non_safety_field" CHECK ("code"='measurements' AND "status" IN ('ACTIVE','REVOKED'));
CREATE UNIQUE INDEX "Waiver_one_active" ON "RequirementWaiver"("itemId","category","code") WHERE "status"='ACTIVE';
ALTER TABLE "IntakeFile" ADD CONSTRAINT "Intake_assignment_consistency" CHECK (("state"='ASSIGNED' AND "assetId" IS NOT NULL) OR ("state" IN ('UNASSIGNED','IGNORED') AND "assetId" IS NULL));
ALTER TABLE "SettlementRule" ADD CONSTRAINT "Rule_bounds" CHECK ("basisPoints" BETWEEN 0 AND 10000 AND "effectiveTo">"effectiveFrom" AND "status" IN ('DRAFT','ACTIVE'));
ALTER TABLE "SettlementStatement" ADD CONSTRAINT "Statement_bounds" CHECK ("periodEnd">"periodStart" AND "currency" IN ('CNY','USD','EUR','HKD','GBP','SGD') AND (("status"='DRAFT' AND "confirmedAt" IS NULL AND "confirmedBy" IS NULL) OR ("status"='CONFIRMED' AND "confirmedAt" IS NOT NULL AND "confirmedBy" IS NOT NULL)));
CREATE INDEX "Outbox_expired_leases" ON "Outbox"("status","leaseUntil");
CREATE INDEX "Item_status_serial" ON "Item"("status","serial");
CREATE OR REPLACE FUNCTION tome_v2_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable evidence: %',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER "CollectionEntry_append_only" BEFORE UPDATE OR DELETE ON "CollectionEntry" FOR EACH ROW EXECUTE FUNCTION tome_v2_append_only();
CREATE TRIGGER "SettlementLine_append_only" BEFORE UPDATE OR DELETE ON "SettlementLine" FOR EACH ROW EXECUTE FUNCTION tome_v2_append_only();
CREATE TRIGGER "ItemAlias_append_only" BEFORE UPDATE OR DELETE ON "ItemAlias" FOR EACH ROW EXECUTE FUNCTION tome_v2_append_only();
CREATE OR REPLACE FUNCTION tome_statement_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'statement cannot be deleted' USING ERRCODE='23514'; END IF;
 IF OLD."status"='CONFIRMED' OR NEW."status"<>'CONFIRMED' OR
   (to_jsonb(OLD)-ARRAY['status','confirmedAt','confirmedBy']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','confirmedAt','confirmedBy'])
 THEN RAISE EXCEPTION 'statement body is immutable; create a correction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SettlementStatement_freeze" BEFORE UPDATE OR DELETE ON "SettlementStatement" FOR EACH ROW EXECUTE FUNCTION tome_statement_freeze();
