-- Reversible item deletion. All item identities, source links and historical rows remain.
ALTER TABLE "Item" ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedBy" UUID,
  ADD COLUMN "deletionReason" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Item_deletedAt_serial_idx" ON "Item" ("deletedAt", "serial");
ALTER TABLE "Item" ADD CONSTRAINT "Item_deleted_metadata"
  CHECK (("deletedAt" IS NULL AND "deletedBy" IS NULL AND "deletionReason" = '') OR
         ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL AND length(btrim("deletionReason")) > 0));
ALTER TABLE "Item" ADD CONSTRAINT "Item_deleted_not_sellable"
  CHECK ("deletedAt" IS NULL OR ("status" = 'PAUSED' AND NOT "approvedValid"));
