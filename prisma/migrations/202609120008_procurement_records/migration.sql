-- Additive procurement/source-order layer. Existing inventory, financial, publishing and test-data constraints are intentionally untouched.
-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "purchaseLineId" UUID;

-- CreateTable
CREATE TABLE "ProcurementSource" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MARKETPLACE',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "supplierId" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "procurementSourceId" UUID NOT NULL,
    "externalOrderNo" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3),
    "sourceStatusRaw" TEXT NOT NULL DEFAULT '',
    "returnabilityRaw" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "subtotalAmount" INTEGER,
    "totalAmount" INTEGER,
    "paymentAmount" INTEGER,
    "rawPayload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderAdjustment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "adjustmentKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sourceSku" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "brandRaw" TEXT NOT NULL DEFAULT '',
    "categoryRaw" TEXT NOT NULL DEFAULT '',
    "productUrl" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "lineAmount" INTEGER,
    "sourceCurrentPrice" INTEGER,
    "sourceEstimatedRetail" INTEGER,
    "sourceConditionRaw" TEXT NOT NULL DEFAULT '',
    "sourceStatusRaw" TEXT NOT NULL DEFAULT '',
    "sizeLabelRaw" TEXT NOT NULL DEFAULT '',
    "colorRaw" TEXT NOT NULL DEFAULT '',
    "materialRaw" TEXT NOT NULL DEFAULT '',
    "measurements" JSONB NOT NULL,
    "measurementsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "descriptionRaw" TEXT NOT NULL DEFAULT '',
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawPayload" JSONB NOT NULL,
    "businessDecision" TEXT NOT NULL DEFAULT 'UNDECIDED',
    "possession" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseShipment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "shipmentKey" TEXT NOT NULL,
    "externalShipmentRef" TEXT NOT NULL DEFAULT '',
    "carrier" TEXT NOT NULL DEFAULT '',
    "statusRaw" TEXT NOT NULL DEFAULT '',
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseShipmentLine" (
    "shipmentId" UUID NOT NULL,
    "lineId" UUID NOT NULL,

    CONSTRAINT "PurchaseShipmentLine_pkey" PRIMARY KEY ("shipmentId","lineId")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "returnKey" TEXT NOT NULL,
    "externalReturnRef" TEXT NOT NULL DEFAULT '',
    "statusRaw" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnLine" (
    "returnId" UUID NOT NULL,
    "lineId" UUID NOT NULL,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("returnId","lineId")
);

-- CreateTable
CREATE TABLE "ItemPurchaseLink" (
    "purchaseLineId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "linkedBy" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ItemPurchaseLink_pkey" PRIMARY KEY ("purchaseLineId")
);

-- CreateTable
CREATE TABLE "PurchaseCostConfirmation" (
    "id" UUID NOT NULL,
    "purchaseLineId" UUID NOT NULL,
    "amountCny" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "confirmedBy" UUID NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PurchaseCostConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementSource_code_key" ON "ProcurementSource"("code");

-- CreateIndex
CREATE INDEX "ProcurementSource_kind_active_idx" ON "ProcurementSource"("kind", "active");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderedAt_idx" ON "PurchaseOrder"("orderedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_sourceStatusRaw_idx" ON "PurchaseOrder"("sourceStatusRaw");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_procurementSourceId_externalOrderNo_key" ON "PurchaseOrder"("procurementSourceId", "externalOrderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderAdjustment_orderId_idx" ON "PurchaseOrderAdjustment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderAdjustment_orderId_adjustmentKey_key" ON "PurchaseOrderAdjustment"("orderId", "adjustmentKey");

-- CreateIndex
CREATE INDEX "PurchaseLine_sourceSku_idx" ON "PurchaseLine"("sourceSku");

-- CreateIndex
CREATE INDEX "PurchaseLine_businessDecision_possession_idx" ON "PurchaseLine"("businessDecision", "possession");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_orderId_lineKey_key" ON "PurchaseLine"("orderId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseShipment_orderId_shipmentKey_key" ON "PurchaseShipment"("orderId", "shipmentKey");

-- CreateIndex
CREATE INDEX "PurchaseShipmentLine_lineId_idx" ON "PurchaseShipmentLine"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_orderId_returnKey_key" ON "PurchaseReturn"("orderId", "returnKey");

-- CreateIndex
CREATE INDEX "PurchaseReturnLine_lineId_idx" ON "PurchaseReturnLine"("lineId");

-- CreateIndex
CREATE INDEX "ItemPurchaseLink_itemId_idx" ON "ItemPurchaseLink"("itemId");

-- CreateIndex
CREATE INDEX "PurchaseCostConfirmation_purchaseLineId_voidedAt_idx" ON "PurchaseCostConfirmation"("purchaseLineId", "voidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Source_purchaseLineId_key" ON "Source"("purchaseLineId");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementSource" ADD CONSTRAINT "ProcurementSource_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_procurementSourceId_fkey" FOREIGN KEY ("procurementSourceId") REFERENCES "ProcurementSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseShipment" ADD CONSTRAINT "PurchaseShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseShipmentLine" ADD CONSTRAINT "PurchaseShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "PurchaseShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseShipmentLine" ADD CONSTRAINT "PurchaseShipmentLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPurchaseLink" ADD CONSTRAINT "ItemPurchaseLink_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPurchaseLink" ADD CONSTRAINT "ItemPurchaseLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCostConfirmation" ADD CONSTRAINT "PurchaseCostConfirmation_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard local workflow states and amounts. Source-platform statuses stay raw text and never imply inventory.
ALTER TABLE "ProcurementSource" ADD CONSTRAINT "ProcurementSource_kind_valid" CHECK ("kind" IN ('MARKETPLACE','SUPPLIER','OFFLINE','OTHER'));
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_version_valid" CHECK ("version" > 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_amounts_nonnegative" CHECK (("subtotalAmount" IS NULL OR "subtotalAmount" >= 0) AND ("totalAmount" IS NULL OR "totalAmount" >= 0) AND ("paymentAmount" IS NULL OR "paymentAmount" >= 0));
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_decision_valid" CHECK ("businessDecision" IN ('UNDECIDED','INCLUDE','EXCLUDE'));
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_possession_valid" CHECK ("possession" IN ('UNKNOWN','IN_HAND','NOT_IN_HAND'));
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_version_valid" CHECK ("version" > 0);
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_amounts_nonnegative" CHECK (("lineAmount" IS NULL OR "lineAmount" >= 0) AND ("sourceCurrentPrice" IS NULL OR "sourceCurrentPrice" >= 0) AND ("sourceEstimatedRetail" IS NULL OR "sourceEstimatedRetail" >= 0));
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_measurements_object" CHECK (jsonb_typeof("measurements") = 'object');
ALTER TABLE "PurchaseCostConfirmation" ADD CONSTRAINT "PurchaseCostConfirmation_amount_valid" CHECK ("amountCny" >= 0);

-- Immutable source-order and line revisions.
-- CreateTable
CREATE TABLE "PurchaseOrderRevision" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLineRevision" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseLineRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderRevision_orderId_version_key" ON "PurchaseOrderRevision"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLineRevision_lineId_version_key" ON "PurchaseLineRevision"("lineId", "version");

-- AddForeignKey
ALTER TABLE "PurchaseOrderRevision" ADD CONSTRAINT "PurchaseOrderRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLineRevision" ADD CONSTRAINT "PurchaseLineRevision_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Only one current RMB cost confirmation per purchase line; old confirmations are voided, never overwritten.
CREATE UNIQUE INDEX "PurchaseCostConfirmation_one_active_per_line" ON "PurchaseCostConfirmation"("purchaseLineId") WHERE "voidedAt" IS NULL;
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_kind_valid" CHECK ("kind" IN ('SHIPPING','DISCOUNT','STORE_CREDIT','TAX','FEE','REFUND','OTHER'));
