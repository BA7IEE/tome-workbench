-- New append-only history. No existing Item, source, Receipt or sequence is rewritten.
CREATE TABLE "IngestConfirmationCorrection" (
 "id" UUID PRIMARY KEY,
 "candidateId" UUID NOT NULL REFERENCES "IngestCandidate"("id") ON DELETE RESTRICT,
 "itemId" UUID NOT NULL REFERENCES "Item"("id") ON DELETE RESTRICT,
 "sourceId" UUID NOT NULL REFERENCES "Source"("id") ON DELETE RESTRICT,
 "purchaseLineId" UUID REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT,
 "originalReceiptId" TEXT NOT NULL REFERENCES "Receipt"("id") ON DELETE RESTRICT,
 "reason" TEXT NOT NULL,
 "createdBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "beforeSnapshot" JSONB NOT NULL,
 "correctedSnapshot" JSONB NOT NULL,
 "restoredAt" TIMESTAMP(3), "restoredBy" UUID REFERENCES "User"("id") ON DELETE RESTRICT,
 "restoreReason" TEXT NOT NULL DEFAULT '', "restoredSnapshot" JSONB,
 CONSTRAINT "IngestCorrection_reason" CHECK (length(trim("reason")) BETWEEN 3 AND 1000),
 CONSTRAINT "IngestCorrection_restore_complete" CHECK (
  ("restoredAt" IS NULL AND "restoredBy" IS NULL AND "restoreReason"='' AND "restoredSnapshot" IS NULL)
  OR ("restoredAt" IS NOT NULL AND "restoredBy" IS NOT NULL AND length(trim("restoreReason")) BETWEEN 3 AND 1000 AND "restoredSnapshot" IS NOT NULL)
 )
);
CREATE UNIQUE INDEX "IngestCorrection_one_active_candidate" ON "IngestConfirmationCorrection"("candidateId") WHERE "restoredAt" IS NULL;
CREATE UNIQUE INDEX "IngestCorrection_one_active_item" ON "IngestConfirmationCorrection"("itemId") WHERE "restoredAt" IS NULL;
CREATE INDEX "IngestConfirmationCorrection_candidateId_createdAt_idx" ON "IngestConfirmationCorrection"("candidateId","createdAt");
CREATE INDEX "IngestConfirmationCorrection_itemId_restoredAt_idx" ON "IngestConfirmationCorrection"("itemId","restoredAt");
CREATE INDEX "IngestConfirmationCorrection_purchaseLineId_restoredAt_idx" ON "IngestConfirmationCorrection"("purchaseLineId","restoredAt");

CREATE FUNCTION tome_confirmation_correction_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'confirmation correction history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."restoredAt" IS NOT NULL OR NEW."restoredAt" IS NULL OR
   (to_jsonb(NEW)-ARRAY['restoredAt','restoredBy','restoreReason','restoredSnapshot']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['restoredAt','restoredBy','restoreReason','restoredSnapshot'])
  THEN RAISE EXCEPTION 'correction history only permits one joint restore transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "IngestCorrection_immutable" BEFORE UPDATE OR DELETE ON "IngestConfirmationCorrection" FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_history();

-- Deferred checks protect against splitting a completed correction through old
-- item/candidate/purchase APIs, while permitting one atomic dedicated restore.
CREATE FUNCTION tome_confirmation_correction_joint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "IngestConfirmationCorrection"%ROWTYPE; c "IngestCandidate"%ROWTYPE;
 i "Item"%ROWTYPE; s "Source"%ROWTYPE; p "PurchaseLine"%ROWTYPE; proof "Receipt"%ROWTYPE;
 identity UUID; name TEXT; dependency_count BIGINT;
BEGIN
 identity := (to_jsonb(NEW)->>'id')::uuid;
 FOR r IN SELECT * FROM "IngestConfirmationCorrection" WHERE "restoredAt" IS NULL AND
  ((TG_TABLE_NAME='IngestConfirmationCorrection' AND "id"=identity)
   OR (TG_TABLE_NAME='IngestCandidate' AND "candidateId"=identity)
   OR (TG_TABLE_NAME='Item' AND "itemId"=identity)
   OR (TG_TABLE_NAME='Source' AND "sourceId"=identity)
   OR (TG_TABLE_NAME='PurchaseLine' AND "purchaseLineId"=identity))
 LOOP
  SELECT * INTO STRICT c FROM "IngestCandidate" WHERE "id"=r."candidateId";
  SELECT * INTO STRICT i FROM "Item" WHERE "id"=r."itemId";
  SELECT * INTO STRICT s FROM "Source" WHERE "id"=r."sourceId";
  SELECT * INTO STRICT proof FROM "Receipt" WHERE "id"=r."originalReceiptId";
  IF c."decision"<>'EXCLUDED' OR c."itemId" IS DISTINCT FROM r."itemId"
   OR c."sourceId" IS DISTINCT FROM r."sourceId" OR c."purchaseLineId" IS DISTINCT FROM r."purchaseLineId"
   OR c."possession" IS DISTINCT FROM (r."beforeSnapshot"->'candidate'->>'possession')
   OR i."deletedAt" IS NULL OR i."status"<>'PAUSED' OR i."approvedValid" OR i."dataMode"<>'BUSINESS' OR i."cycle"<>1
   OR i."sourceId" IS DISTINCT FROM r."sourceId" OR s."purchaseLineId" IS DISTINCT FROM r."purchaseLineId"
   OR i."serial" IS DISTINCT FROM (r."beforeSnapshot"->'item'->>'serial')::integer
   OR proof."operation"<>'ingest.candidate.confirm'
   OR proof."response"->>'id' IS DISTINCT FROM r."candidateId"::text
   OR proof."response"->>'itemId' IS DISTINCT FROM r."itemId"::text
   OR proof."response"->>'existing' IS DISTINCT FROM 'false'
   OR (SELECT count(*) FROM "Item" WHERE "sourceId"=s."id")<>1
   OR (SELECT count(*) FROM "IngestCandidate" WHERE "itemId"=i."id" OR "sourceId"=s."id")<>1
   OR (SELECT count(*) FROM "ItemSourceLink" WHERE "sourceId"=s."id")<>1
   OR (SELECT count(*) FROM "ItemSourceLink" WHERE "itemId"=i."id")<>1
   OR NOT EXISTS(SELECT 1 FROM "ItemSourceLink" WHERE "itemId"=i."id" AND "sourceId"=s."id" AND "kind"='ACQUISITION')
  THEN RAISE EXCEPTION 'active correction requires a joint domain transition and original new-item proof' USING ERRCODE='23514'; END IF;
  FOREACH name IN ARRAY ARRAY['Sale','CostEntry','Reservation','Observation','Inquiry','Movement','Listing','DistributionTarget','DistributionAttempt','PublishingDraft','UsePackage','MaterialExportEntry','Offer','ExceptionIntent','Task','Suggestion','RequirementWaiver','ChannelPrice','ItemAlias','CollectionEntry']
  LOOP
   EXECUTE format('SELECT count(*) FROM %I WHERE "itemId"=$1',name) INTO dependency_count USING i."id";
   IF dependency_count<>0 THEN RAISE EXCEPTION 'active correction has a protected downstream reference' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF r."purchaseLineId" IS NOT NULL THEN
   SELECT * INTO STRICT p FROM "PurchaseLine" WHERE "id"=r."purchaseLineId";
   IF p."businessDecision"<>'EXCLUDE' OR p."possession" IS DISTINCT FROM (r."beforeSnapshot"->'purchaseLine'->>'possession')
    OR (SELECT count(*) FROM "ItemPurchaseLink" WHERE "itemId"=i."id")<>1
    OR NOT EXISTS(SELECT 1 FROM "ItemPurchaseLink" WHERE "itemId"=i."id" AND "purchaseLineId"=p."id")
   THEN RAISE EXCEPTION 'active correction cannot split its purchase decision' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS(SELECT 1 FROM "ItemPurchaseLink" WHERE "itemId"=i."id") THEN
   RAISE EXCEPTION 'active correction has an unexpected purchase link' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "IngestCorrection_joint" AFTER INSERT OR UPDATE ON "IngestConfirmationCorrection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_joint();
CREATE CONSTRAINT TRIGGER "Item_correction_joint" AFTER UPDATE ON "Item" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_joint();
CREATE CONSTRAINT TRIGGER "Candidate_correction_joint" AFTER UPDATE ON "IngestCandidate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_joint();
CREATE CONSTRAINT TRIGGER "Source_correction_joint" AFTER UPDATE ON "Source" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_joint();
CREATE CONSTRAINT TRIGGER "PurchaseLine_correction_joint" AFTER UPDATE ON "PurchaseLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_joint();

-- Domain handlers recheck first. This DB defense also protects bypassing APIs
-- and racing references that do not share an existing item advisory lock.
CREATE FUNCTION tome_confirmation_correction_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data JSONB; old_data JSONB; item_id UUID; old_item_id UUID; line_id UUID; old_line_id UUID; resource_id UUID; source_id UUID; old_source_id UUID;
BEGIN
 IF TG_OP<>'DELETE' THEN row_data:=to_jsonb(NEW); END IF;
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 item_id:=(row_data->>'itemId')::uuid; old_item_id:=(old_data->>'itemId')::uuid;
 source_id:=(row_data->>'sourceId')::uuid; old_source_id:=(old_data->>'sourceId')::uuid;
 line_id:=(row_data->>'purchaseLineId')::uuid; old_line_id:=(old_data->>'purchaseLineId')::uuid;
 -- Serialize only referenced domain resources. Correction never waits for
 -- these locks: its try-lock failure releases the financial boundary.
 IF TG_WHEN='BEFORE' THEN
  FOR resource_id IN SELECT DISTINCT x FROM unnest(ARRAY[item_id,old_item_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('item:'||resource_id::text,0));
  END LOOP;
  IF TG_TABLE_NAME IN ('ItemSourceLink','IngestCandidate','Item') THEN
   FOR resource_id IN SELECT DISTINCT x FROM unnest(ARRAY[source_id,old_source_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('source:'||resource_id::text,0));
   END LOOP;
  END IF;
  IF TG_TABLE_NAME='PurchaseCostConfirmation' THEN
   FOR resource_id IN SELECT DISTINCT x FROM unnest(ARRAY[line_id,old_line_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('purchase-line:'||resource_id::text,0));
   END LOOP;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM "IngestConfirmationCorrection" WHERE "restoredAt" IS NULL AND
  ("itemId" IN (item_id,old_item_id)
   OR (TG_TABLE_NAME IN ('ItemSourceLink','IngestCandidate','Item') AND "sourceId" IN (source_id,old_source_id))
   OR (TG_TABLE_NAME='PurchaseCostConfirmation' AND "purchaseLineId" IN (line_id,old_line_id)))
  AND (TG_TABLE_NAME<>'IngestCandidate' OR "candidateId" NOT IN (COALESCE((row_data->>'id')::uuid,(old_data->>'id')::uuid)))
  AND (TG_TABLE_NAME<>'Item' OR "itemId" NOT IN (COALESCE((row_data->>'id')::uuid,(old_data->>'id')::uuid))))
 THEN RAISE EXCEPTION 'active confirmation correction blocks downstream writes and link changes' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE name TEXT; BEGIN
 FOREACH name IN ARRAY ARRAY['Sale','CostEntry','Reservation','Observation','Inquiry','Movement','Listing','DistributionTarget','DistributionAttempt','PublishingDraft','UsePackage','MaterialExportEntry','Offer','ExceptionIntent','Task','Suggestion','RequirementWaiver','ChannelPrice','ItemAlias','CollectionEntry','ItemSourceLink','ItemPurchaseLink','PurchaseCostConfirmation','IngestCandidate','Item']
 LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_reference()',name||'_active_correction',name);
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_confirmation_correction_reference()',name||'_correction_commit',name);
 END LOOP;
END $$;
