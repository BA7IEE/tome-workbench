-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PublishingDraft" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "assetIds" JSONB NOT NULL DEFAULT '[]',
    "basisRevisionId" UUID,
    "basisPrice" INTEGER,
    "basisCurrency" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishingDraft_itemId_channelId_purpose_key" ON "PublishingDraft"("itemId", "channelId", "purpose");

-- CreateIndex
CREATE INDEX "Asset_itemId_archived_position_idx" ON "Asset"("itemId", "archived", "position");

-- AddForeignKey
ALTER TABLE "PublishingDraft" ADD CONSTRAINT "PublishingDraft_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingDraft" ADD CONSTRAINT "PublishingDraft_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingDraft" ADD CONSTRAINT "PublishingDraft_basisRevisionId_itemId_fkey" FOREIGN KEY ("basisRevisionId", "itemId") REFERENCES "ItemRevision"("id", "itemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Editable working copies do not change immutable publication history.
ALTER TABLE "PublishingDraft" ADD CONSTRAINT "PublishingDraft_input_bounds" CHECK (
  "purpose" IN ('TRADE','SHOWROOM','CUSTOMER_CARD') AND
  "version" > 0 AND
  ("basisPrice" IS NULL OR "basisPrice" >= 0) AND
  "basisCurrency" IN ('CNY','USD','EUR','HKD','GBP','SGD') AND
  jsonb_typeof("assetIds") = 'array'
);
