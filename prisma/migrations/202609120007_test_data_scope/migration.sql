-- Explicit test scope; no existing inventory or transaction is rewritten or deleted.
ALTER TABLE "Item" ADD COLUMN "dataMode" TEXT NOT NULL DEFAULT 'BUSINESS',
 ADD COLUMN "testMarkedAt" TIMESTAMP(3), ADD COLUMN "testMarkedBy" UUID,
 ADD COLUMN "testReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Item" ADD CONSTRAINT "Item_test_scope_metadata" CHECK (
 ("dataMode" = 'BUSINESS' AND "testMarkedAt" IS NULL AND "testMarkedBy" IS NULL AND "testReason" = '') OR
 ("dataMode" = 'TEST' AND "testMarkedAt" IS NOT NULL AND "testMarkedBy" IS NOT NULL AND length(btrim("testReason")) > 0));
CREATE INDEX "Item_dataMode_deletedAt_serial_idx" ON "Item" ("dataMode", "deletedAt", "serial");
