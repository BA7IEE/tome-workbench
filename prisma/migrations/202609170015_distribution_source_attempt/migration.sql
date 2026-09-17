-- A stop record belongs to the concrete successful publish/update generation it
-- stops. Historical records remain untouched; new records use this forward link.
ALTER TABLE "DistributionAttempt"
  ADD COLUMN "sourceAttemptId" UUID;

ALTER TABLE "DistributionAttempt"
  ADD CONSTRAINT "DistributionAttempt_sourceAttemptId_fkey"
  FOREIGN KEY ("sourceAttemptId") REFERENCES "DistributionAttempt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DistributionAttempt_sourceAttemptId_idx"
  ON "DistributionAttempt"("sourceAttemptId");
