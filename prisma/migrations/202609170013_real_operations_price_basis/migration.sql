-- Keep editable channel drafts tied to the exact effective-price source that
-- was reviewed. Immutable UsePackage snapshots carry their own price basis.
ALTER TABLE "PublishingDraft"
  ADD COLUMN "basisPriceSource" TEXT NOT NULL DEFAULT 'ITEM',
  ADD COLUMN "basisPriceVersion" INTEGER;

ALTER TABLE "PublishingDraft"
  ADD CONSTRAINT "PublishingDraft_price_basis_check"
  CHECK (
    ("basisPriceSource" = 'ITEM' AND "basisPriceVersion" IS NULL)
    OR ("basisPriceSource" = 'CHANNEL' AND "basisPriceVersion" > 0)
  );
