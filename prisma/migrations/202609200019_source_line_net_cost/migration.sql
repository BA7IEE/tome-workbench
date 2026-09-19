-- Preserve the source's per-item post-discount amount separately from both
-- the order-list price and a marketplace's current listing price. Existing
-- rows stay NULL: a forward migration cannot infer that historical
-- sourceCurrentPrice values had the same meaning.
ALTER TABLE "PurchaseLine"
  ADD COLUMN "sourceLineNetAmount" INTEGER;

ALTER TABLE "IngestCandidate"
  ADD COLUMN "sourceLineNetAmount" INTEGER;

ALTER TABLE "PurchaseLine"
  DROP CONSTRAINT "PurchaseLine_amounts_nonnegative";

ALTER TABLE "PurchaseLine"
  ADD CONSTRAINT "PurchaseLine_amounts_nonnegative"
  CHECK (
    ("lineAmount" IS NULL OR "lineAmount" >= 0)
    AND ("sourceLineNetAmount" IS NULL OR "sourceLineNetAmount" >= 0)
    AND ("sourceCurrentPrice" IS NULL OR "sourceCurrentPrice" >= 0)
    AND ("sourceEstimatedRetail" IS NULL OR "sourceEstimatedRetail" >= 0)
  );

ALTER TABLE "IngestCandidate"
  DROP CONSTRAINT "IngestCandidate_amounts_nonnegative";

ALTER TABLE "IngestCandidate"
  ADD CONSTRAINT "IngestCandidate_amounts_nonnegative"
  CHECK (
    ("sourceLineAmount" IS NULL OR "sourceLineAmount" >= 0)
    AND ("sourceLineNetAmount" IS NULL OR "sourceLineNetAmount" >= 0)
    AND ("sourceCurrentPrice" IS NULL OR "sourceCurrentPrice" >= 0)
    AND ("sourceEstimatedRetail" IS NULL OR "sourceEstimatedRetail" >= 0)
  );

ALTER TABLE "ProcurementSource"
  DROP CONSTRAINT "ProcurementSource_cost_policy_valid";

ALTER TABLE "ProcurementSource"
  ADD CONSTRAINT "ProcurementSource_cost_policy_valid"
  CHECK (
    "version" > 0
    AND "orderOverheadCny" >= 0
    AND "costAllocationMethod" IN (
      'PROPORTIONAL_LINE_AMOUNT',
      'PROPORTIONAL_LINE_NET_AMOUNT'
    )
  );
