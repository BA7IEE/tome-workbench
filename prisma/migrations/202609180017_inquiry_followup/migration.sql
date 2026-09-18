-- Keep the next customer follow-up as an explicit, schedulable Inquiry fact.
-- Existing inquiry history remains intact and is not backfilled or reinterpreted.
ALTER TABLE "Inquiry"
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE INDEX "Inquiry_nextFollowUpAt_state_idx"
  ON "Inquiry"("nextFollowUpAt", "state");
