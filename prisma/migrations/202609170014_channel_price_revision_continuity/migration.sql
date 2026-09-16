-- Keep ChannelPrice revisions monotonic across an explicit fallback.
-- A disabled row is ignored by resolveChannelPrice(), but avoids reviving a
-- frozen UsePackage if the same override is later restored.
ALTER TABLE "ChannelPrice"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
