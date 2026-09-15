-- Additive history only: no inventory, finance, or applied migration is changed.
CREATE TABLE "IngestBatchMember" (
  "batchId" UUID NOT NULL REFERENCES "IngestBatch"("id") ON DELETE RESTRICT,
  "candidateId" UUID NOT NULL REFERENCES "IngestCandidate"("id") ON DELETE RESTRICT,
  "firstVersion" INTEGER NOT NULL CHECK ("firstVersion" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("batchId", "candidateId")
);
CREATE INDEX "IngestBatchMember_candidateId_idx" ON "IngestBatchMember"("candidateId");
-- Only current, provable membership is backfilled. Earlier overwritten membership
-- cannot be inferred and is not fabricated.
INSERT INTO "IngestBatchMember" ("batchId", "candidateId", "firstVersion", "createdAt")
SELECT "batchId", "id", "version", "createdAt" FROM "IngestCandidate";
CREATE TRIGGER "IngestBatchMember_append_only" BEFORE UPDATE OR DELETE ON "IngestBatchMember"
FOR EACH ROW EXECUTE FUNCTION tome_append_only();

CREATE TABLE "MaterialExport" (
  "id" UUID PRIMARY KEY,
  "createdBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "title" TEXT NOT NULL,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('OPERATIONS', 'INTERNAL')),
  "dataMode" TEXT NOT NULL CHECK ("dataMode" IN ('BUSINESS', 'TEST'))
);
CREATE INDEX "MaterialExport_createdAt_id_idx" ON "MaterialExport"("createdAt", "id");
CREATE TABLE "MaterialExportEntry" (
  "exportId" UUID NOT NULL REFERENCES "MaterialExport"("id") ON DELETE RESTRICT,
  "itemId" UUID NOT NULL REFERENCES "Item"("id") ON DELETE RESTRICT,
  "snapshot" JSONB NOT NULL,
  PRIMARY KEY ("exportId", "itemId")
);
CREATE INDEX "MaterialExportEntry_itemId_idx" ON "MaterialExportEntry"("itemId");
CREATE TRIGGER "MaterialExport_append_only" BEFORE UPDATE OR DELETE ON "MaterialExport"
FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "MaterialExportEntry_append_only" BEFORE UPDATE OR DELETE ON "MaterialExportEntry"
FOR EACH ROW EXECUTE FUNCTION tome_append_only();
