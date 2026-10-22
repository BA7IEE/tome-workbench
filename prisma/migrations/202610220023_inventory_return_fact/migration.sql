BEGIN;

-- Physical custody and the historical full-refund flag are separate facts.
-- Preserve Sale_complete_return and every existing monetary value unchanged.
ALTER TABLE "Sale" ADD COLUMN "inventoryReturnedAt" TIMESTAMP(3);

CREATE FUNCTION guard_unrecorded_inventory_return() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."inventoryReturnedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'inventory return must reference an existing recorded sale';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."inventoryReturnedAt" IS NOT NULL THEN
    IF NEW."inventoryReturnedAt" IS DISTINCT FROM OLD."inventoryReturnedAt" THEN
      RAISE EXCEPTION 'inventory return fact is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."inventoryReturnedAt" IS NOT NULL THEN
    IF OLD.version <> 1 OR NEW.version <> OLD.version + 1
       OR OLD.amount IS NOT NULL OR OLD.fees IS NOT NULL OR OLD.paid OR OLD.refunded <> 0 OR OLD.returned
       OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.cost IS DISTINCT FROM OLD.cost
       OR NEW.fees IS DISTINCT FROM OLD.fees OR NEW.refunded IS DISTINCT FROM OLD.refunded
       OR NEW.paid IS DISTINCT FROM OLD.paid OR NEW.returned IS DISTINCT FROM OLD.returned
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.cooperation IS DISTINCT FROM OLD.cooperation
       OR NEW."itemId" IS DISTINCT FROM OLD."itemId" OR NEW."cycleNumber" IS DISTINCT FROM OLD."cycleNumber"
       OR EXISTS (SELECT 1 FROM "Adjustment" WHERE "saleId" = OLD.id) THEN
      RAISE EXCEPTION 'financially maintained sale requires the original protected return flow';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_inventory_return_guard"
BEFORE INSERT OR UPDATE OF "inventoryReturnedAt" ON "Sale"
FOR EACH ROW EXECUTE FUNCTION guard_unrecorded_inventory_return();

DROP INDEX "Sale_one_open_sale_in_cycle";
CREATE UNIQUE INDEX "Sale_one_open_sale_in_cycle" ON "Sale" ("itemId", "cycleNumber")
WHERE "returned" = false AND "inventoryReturnedAt" IS NULL;

COMMIT;
