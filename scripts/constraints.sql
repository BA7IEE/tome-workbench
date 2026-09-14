-- Append to the initial Prisma-generated migration BEFORE using any real data.
-- All write paths retain the item lock; these constraints add independent DB protection.
CREATE UNIQUE INDEX "Reservation_one_active_item" ON "Reservation" ("itemId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "Sale_one_open_sale_in_cycle" ON "Sale" ("itemId", "cycleNumber") WHERE "returned" = false;
ALTER TABLE "Item" ADD CONSTRAINT "Item_current_cycle_anchor" FOREIGN KEY ("id", "cycle") REFERENCES "Cycle"("itemId", "number") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Item" ADD CONSTRAINT "Item_approved_revision_anchor" FOREIGN KEY ("approvedId", "id") REFERENCES "ItemRevision"("id", "itemId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Item" ADD CONSTRAINT "Item_valid_approval" CHECK (NOT "approvedValid" OR "approvedId" IS NOT NULL);
ALTER TABLE "Item" ADD CONSTRAINT "Item_nonnegative_price" CHECK ("currentPrice" IS NULL OR "currentPrice" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amount_bounds" CHECK (("amount" IS NULL OR "amount">=0) AND ("cost" IS NULL OR "cost">=0) AND ("fees" IS NULL OR "fees">=0) AND "refunded">=0 AND ("refunded"=0 OR ("amount" IS NOT NULL AND "refunded"<="amount")));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_complete_return" CHECK (NOT "returned" OR ("amount" IS NOT NULL AND "refunded"="amount"));
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_positive" CHECK ("amount">0);
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_nonnegative" CHECK ("amount" IS NULL OR "amount">=0);
ALTER TABLE "User" ADD CONSTRAINT "User_known_role" CHECK ("role" IN ('ADMIN','REVIEWER','OPERATOR','FINANCE','VIEWER'));
ALTER TABLE "Item" ADD CONSTRAINT "Item_known_status" CHECK ("status" IN ('AVAILABLE','PAUSED','RESERVED','SOLD','SUPPLIER_SOLD','GIFTED','SELF_USE','QUARANTINED'));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_known_scope" CHECK ("cooperation" IN ('INCLUDED','EXCLUDED','PENDING_REVIEW'));
CREATE FUNCTION tome_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'This record is append-only'; END $$;
CREATE TRIGGER "Audit_append_only" BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "Adjustment_append_only" BEFORE UPDATE OR DELETE ON "Adjustment" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "UsePackage_append_only" BEFORE UPDATE OR DELETE ON "UsePackage" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE TRIGGER "SourceRevision_append_only" BEFORE UPDATE OR DELETE ON "SourceRevision" FOR EACH ROW EXECUTE FUNCTION tome_append_only();
CREATE FUNCTION tome_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."itemId" <> OLD."itemId" OR NEW."version" <> OLD."version" THEN RAISE EXCEPTION 'Revision identity and snapshot are immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "ItemRevision_snapshot_immutable" BEFORE UPDATE ON "ItemRevision" FOR EACH ROW EXECUTE FUNCTION tome_revision_immutable();

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_nonnegative" CHECK ("amount">=0);
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_cycle_anchor" FOREIGN KEY ("itemId", "cycleNumber") REFERENCES "Cycle"("itemId", "number");
