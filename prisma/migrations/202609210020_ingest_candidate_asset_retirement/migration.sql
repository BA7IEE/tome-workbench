ALTER TABLE "IngestCandidateAsset"
ADD COLUMN "retiredAt" TIMESTAMP(3),
ADD COLUMN "retiredReason" TEXT NOT NULL DEFAULT '';

CREATE INDEX "IngestCandidateAsset_candidateId_retiredAt_createdAt_idx"
ON "IngestCandidateAsset"("candidateId", "retiredAt", "createdAt");
