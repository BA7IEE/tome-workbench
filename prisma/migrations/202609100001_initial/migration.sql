-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "csrf" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "supplierId" UUID,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRevision" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "serial" SERIAL NOT NULL,
    "sourceId" UUID,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'CLOTHING',
    "ownership" TEXT NOT NULL DEFAULT 'OWN',
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "location" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "facts" JSONB NOT NULL,
    "approvedId" UUID,
    "approvedValid" BOOLEAN NOT NULL DEFAULT false,
    "currentPrice" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "cooperation" TEXT NOT NULL DEFAULT 'INCLUDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "itemId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "cooperation" TEXT NOT NULL DEFAULT 'INCLUDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("itemId","number")
);

-- CreateTable
CREATE TABLE "ItemRevision" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierCode" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "canReserve" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRODUCT',
    "origin" TEXT NOT NULL DEFAULT 'OWN',
    "rights" TEXT NOT NULL DEFAULT 'INTERNAL',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "sourceNote" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "titleLimit" INTEGER NOT NULL DEFAULT 80,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsePackage" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "cycle" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "remoteId" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "desired" TEXT NOT NULL DEFAULT 'LIVE',
    "observed" TEXT NOT NULL DEFAULT 'MANUAL_REPORTED_LIVE',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "listingId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignee" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "customerRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionIntent" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "cycle" INTEGER NOT NULL,
    "customerRef" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExceptionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "externalKey" TEXT,
    "channel" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'RECORDED',
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "cost" INTEGER,
    "fees" INTEGER,
    "refunded" INTEGER NOT NULL DEFAULT 0,
    "returned" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "cooperation" TEXT NOT NULL DEFAULT 'INCLUDED',
    "intentId" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "quote" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "inputVersion" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movement" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Source_sourceKey_key" ON "Source"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRevision_sourceId_version_key" ON "SourceRevision"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Item_serial_key" ON "Item"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sourceId_key" ON "Item"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRevision_itemId_version_key" ON "ItemRevision"("itemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRevision_id_itemId_key" ON "ItemRevision"("id", "itemId");

-- CreateIndex
CREATE INDEX "Offer_validUntil_idx" ON "Offer"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_objectKey_key" ON "Asset"("objectKey");

-- CreateIndex
CREATE INDEX "Asset_itemId_idx" ON "Asset"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "UsePackage_id_itemId_channelId_key" ON "UsePackage"("id", "itemId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_channelId_remoteId_key" ON "Listing"("channelId", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_dedupeKey_key" ON "Task"("dedupeKey");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Reservation_itemId_status_idx" ON "Reservation"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_externalKey_key" ON "Sale"("externalKey");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE INDEX "Audit_resourceId_createdAt_idx" ON "Audit"("resourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_actorId_operation_key_key" ON "Receipt"("actorId", "operation", "key");

-- CreateIndex
CREATE INDEX "Outbox_status_nextAt_idx" ON "Outbox"("status", "nextAt");

-- CreateIndex
CREATE INDEX "CostEntry_itemId_cycleNumber_idx" ON "CostEntry"("itemId", "cycleNumber");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRevision" ADD CONSTRAINT "SourceRevision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRevision" ADD CONSTRAINT "ItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsePackage" ADD CONSTRAINT "UsePackage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsePackage" ADD CONSTRAINT "UsePackage_revisionId_itemId_fkey" FOREIGN KEY ("revisionId", "itemId") REFERENCES "ItemRevision"("id", "itemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsePackage" ADD CONSTRAINT "UsePackage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_packageId_itemId_channelId_fkey" FOREIGN KEY ("packageId", "itemId", "channelId") REFERENCES "UsePackage"("id", "itemId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionIntent" ADD CONSTRAINT "ExceptionIntent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_itemId_cycleNumber_fkey" FOREIGN KEY ("itemId", "cycleNumber") REFERENCES "Cycle"("itemId", "number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append to the initial Prisma-generated migration BEFORE using any real data.
-- All write paths retain the item lock; these constraints add independent DB protection.
CREATE UNIQUE INDEX "Reservation_one_active_item" ON "Reservation" ("itemId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "Sale_one_open_sale_in_cycle" ON "Sale" ("itemId", "cycleNumber") WHERE "returned" = false;
ALTER TABLE "Item" ADD CONSTRAINT "Item_current_cycle_anchor" FOREIGN KEY ("id", "cycle") REFERENCES "Cycle"("itemId", "number") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Item" ADD CONSTRAINT "Item_approved_revision_anchor" FOREIGN KEY ("approvedId", "id") REFERENCES "ItemRevision"("id", "itemId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Item" ADD CONSTRAINT "Item_valid_approval" CHECK (NOT "approvedValid" OR "approvedId" IS NOT NULL);
ALTER TABLE "Item" ADD CONSTRAINT "Item_nonnegative_price" CHECK ("currentPrice" IS NULL OR "currentPrice" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amount_bounds" CHECK (("amount" IS NULL OR "amount">=0) AND ("cost" IS NULL OR "cost">=0) AND ("fees" IS NULL OR "fees">=0) AND "refunded">=0 AND ("refunded"=0 OR ("amount" IS NOT NULL AND "refunded"<="amount")));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_complete_return" CHECK (NOT "returned" OR ("amount" IS NOT NULL AND "refunded"="amount"));
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_positive" CHECK ("amount">0);
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_nonnegative" CHECK ("amount" IS NULL OR "amount">=0);
ALTER TABLE "User" ADD CONSTRAINT "User_known_role" CHECK ("role" IN ('ADMIN','REVIEWER','OPERATOR','FINANCE','VIEWER'));
ALTER TABLE "Item" ADD CONSTRAINT "Item_known_status" CHECK ("status" IN ('AVAILABLE','PAUSED','RESERVED','SOLD','SUPPLIER_SOLD','GIFTED','SELF_USE','QUARANTINED'));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_known_scope" CHECK ("cooperation" IN ('INCLUDED','EXCLUDED','PENDING_REVIEW'));
CREATE FUNCTION tome_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'This record is append-only'; END $$;
CREATE TRIGGER "Audit_append_only" BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "Adjustment_append_only" BEFORE UPDATE OR DELETE ON "Adjustment" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "UsePackage_append_only" BEFORE UPDATE OR DELETE ON "UsePackage" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "SourceRevision_append_only" BEFORE UPDATE OR DELETE ON "SourceRevision" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE FUNCTION tome_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."itemId" <> OLD."itemId" OR NEW."version" <> OLD."version" THEN RAISE EXCEPTION 'Revision identity and snapshot are immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "ItemRevision_snapshot_immutable" BEFORE UPDATE ON "ItemRevision" FOR EACH ROW EXECUTE FUNCTION tome_revision_immutable();

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_nonnegative" CHECK ("amount">=0);
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_cycle_anchor" FOREIGN KEY ("itemId", "cycleNumber") REFERENCES "Cycle"("itemId", "number");
