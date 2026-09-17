-- Explicitly record where an item is intended to trade. This is additive:
-- historical handoff and Listing facts remain untouched and are not backfilled.

ALTER TABLE "Channel"
  ADD COLUMN "businessPurpose" TEXT NOT NULL DEFAULT 'TRADE';

UPDATE "Channel"
SET "businessPurpose" = CASE "platform"
  WHEN 'XHS' THEN 'CONTENT'
  WHEN 'SHOWROOM' THEN 'SHOWROOM'
  ELSE 'TRADE'
END;

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_businessPurpose_valid"
  CHECK ("businessPurpose" IN ('TRADE', 'CONTENT', 'SHOWROOM'));

CREATE TABLE "DistributionTarget" (
  "id" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "note" TEXT NOT NULL DEFAULT '',
  "createdBy" UUID NOT NULL,
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DistributionTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DistributionTarget_version_positive" CHECK ("version" > 0),
  CONSTRAINT "DistributionTarget_itemId_channelId_key" UNIQUE ("itemId", "channelId")
);

CREATE INDEX "DistributionTarget_channelId_active_idx"
  ON "DistributionTarget"("channelId", "active");

CREATE INDEX "DistributionTarget_itemId_active_idx"
  ON "DistributionTarget"("itemId", "active");

ALTER TABLE "DistributionTarget"
  ADD CONSTRAINT "DistributionTarget_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DistributionTarget_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
