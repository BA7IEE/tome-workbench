-- Forward-only integration of the original candidate anchor with compensation.
-- Ordinary candidates retain their original contract. An EXCLUDED candidate
-- can retain its TM only while the matching correction is active at commit.
ALTER TABLE "IngestCandidate" DROP CONSTRAINT "IngestCandidate_item_confirmation_anchor";
ALTER TABLE "IngestCandidate" ADD CONSTRAINT "IngestCandidate_item_confirmation_anchor" CHECK (
 ("decision"='CONFIRMED' AND "itemId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
 OR ("decision"<>'CONFIRMED' AND "itemId" IS NULL)
 OR ("decision"='EXCLUDED' AND "itemId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
);
CREATE FUNCTION tome_candidate_correction_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "IngestCandidate"%ROWTYPE; candidate_id UUID;
BEGIN
 IF TG_TABLE_NAME='IngestCandidate' THEN candidate_id:=NEW."id";
 ELSE candidate_id:=NEW."candidateId"; END IF;
 SELECT * INTO STRICT c FROM "IngestCandidate" WHERE "id"=candidate_id;
 IF c."decision"='EXCLUDED' AND c."itemId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "IngestConfirmationCorrection" WHERE "candidateId"=c."id" AND "itemId"=c."itemId"
   AND "sourceId" IS NOT DISTINCT FROM c."sourceId" AND "purchaseLineId" IS NOT DISTINCT FROM c."purchaseLineId"
   AND "restoredAt" IS NULL
 ) THEN RAISE EXCEPTION 'excluded candidate can retain its TM only with an active joint correction' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Candidate_retained_correction_anchor" AFTER INSERT OR UPDATE ON "IngestCandidate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_candidate_correction_anchor();
CREATE CONSTRAINT TRIGGER "Correction_retained_candidate_anchor" AFTER INSERT OR UPDATE ON "IngestConfirmationCorrection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_candidate_correction_anchor();

-- Closing history cannot silently unlock the old partial restore paths. Check
-- the exact completed restore once, without freezing later legitimate changes.
CREATE FUNCTION tome_correction_restore_joint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "IngestCandidate"%ROWTYPE; i "Item"%ROWTYPE; s "Source"%ROWTYPE; p "PurchaseLine"%ROWTYPE;
 name TEXT; dependency_count BIGINT;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."restoredAt" IS NOT NULL THEN RAISE EXCEPTION 'correction history must start active' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF OLD."restoredAt" IS NOT NULL OR NEW."restoredAt" IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT c FROM "IngestCandidate" WHERE "id"=NEW."candidateId";
 SELECT * INTO STRICT i FROM "Item" WHERE "id"=NEW."itemId";
 SELECT * INTO STRICT s FROM "Source" WHERE "id"=NEW."sourceId";
 IF c."decision"<>'CONFIRMED' OR c."itemId" IS DISTINCT FROM i."id" OR c."sourceId" IS DISTINCT FROM s."id"
  OR c."purchaseLineId" IS DISTINCT FROM NEW."purchaseLineId" OR c."confirmedAt" IS NULL
  OR c."possession" IS DISTINCT FROM (NEW."beforeSnapshot"->'candidate'->>'possession')
  OR i."deletedAt" IS NOT NULL OR i."status"<>'PAUSED' OR i."approvedValid" OR i."dataMode"<>'BUSINESS' OR i."cycle"<>1
  OR i."sourceId" IS DISTINCT FROM s."id" OR s."purchaseLineId" IS DISTINCT FROM NEW."purchaseLineId"
  OR i."serial" IS DISTINCT FROM (NEW."beforeSnapshot"->'item'->>'serial')::integer
  OR (SELECT count(*) FROM "IngestCandidate" WHERE "itemId"=i."id" OR "sourceId"=s."id")<>1
  OR (SELECT count(*) FROM "Item" WHERE "sourceId"=s."id")<>1
  OR (SELECT count(*) FROM "ItemSourceLink" WHERE "sourceId"=s."id" OR "itemId"=i."id")<>1
  OR NOT EXISTS(SELECT 1 FROM "ItemSourceLink" WHERE "sourceId"=s."id" AND "itemId"=i."id" AND "kind"='ACQUISITION')
  OR NEW."restoredSnapshot"->'candidate'->>'id' IS DISTINCT FROM c."id"::text
  OR NEW."restoredSnapshot"->'candidate'->>'decision' IS DISTINCT FROM 'CONFIRMED'
  OR NEW."restoredSnapshot"->'candidate'->'version' IS DISTINCT FROM to_jsonb(c."version")
  OR NEW."restoredSnapshot"->'item'->>'id' IS DISTINCT FROM i."id"::text
  OR NEW."restoredSnapshot"->'item'->'version' IS DISTINCT FROM to_jsonb(i."version")
  OR NEW."restoredSnapshot"->'item'->>'status' IS DISTINCT FROM 'PAUSED'
  OR NEW."restoredSnapshot"->'item'->'deletedAt' IS DISTINCT FROM 'null'::jsonb
  OR NEW."restoredSnapshot"->'item'->>'approvedValid' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'correction history can close only with the original paused joint restore' USING ERRCODE='23514'; END IF;
 FOREACH name IN ARRAY ARRAY['Sale','CostEntry','Reservation','Observation','Inquiry','Movement','Listing','DistributionTarget','DistributionAttempt','PublishingDraft','UsePackage','MaterialExportEntry','Offer','ExceptionIntent','Task','Suggestion','RequirementWaiver','ChannelPrice','ItemAlias','CollectionEntry']
 LOOP
  EXECUTE format('SELECT count(*) FROM %I WHERE "itemId"=$1',name) INTO dependency_count USING i."id";
  IF dependency_count<>0 THEN RAISE EXCEPTION 'joint restore has a protected downstream reference' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NEW."purchaseLineId" IS NOT NULL THEN
  SELECT * INTO STRICT p FROM "PurchaseLine" WHERE "id"=NEW."purchaseLineId";
  IF p."businessDecision"<>'INCLUDE' OR p."possession" IS DISTINCT FROM (NEW."beforeSnapshot"->'purchaseLine'->>'possession')
   OR (SELECT count(*) FROM "ItemPurchaseLink" WHERE "itemId"=i."id")<>1
   OR NOT EXISTS(SELECT 1 FROM "ItemPurchaseLink" WHERE "itemId"=i."id" AND "purchaseLineId"=p."id")
   OR NEW."restoredSnapshot"->'purchaseLine'->>'id' IS DISTINCT FROM p."id"::text
   OR NEW."restoredSnapshot"->'purchaseLine'->'version' IS DISTINCT FROM to_jsonb(p."version")
   OR NEW."restoredSnapshot"->'purchaseLine'->>'businessDecision' IS DISTINCT FROM 'INCLUDE'
   OR EXISTS(SELECT 1 FROM "PurchaseReturnLine" WHERE "lineId"=p."id")
   OR EXISTS(SELECT 1 FROM "PurchaseOrderCostBasis" WHERE "orderId"=p."orderId")
   OR EXISTS(SELECT 1 FROM "PurchaseCostConfirmation" pc JOIN "PurchaseLine" pl ON pc."purchaseLineId"=pl."id" WHERE pl."orderId"=p."orderId")
   OR EXISTS(SELECT 1 FROM "CostEntry" ce JOIN "ItemPurchaseLink" ip ON ce."itemId"=ip."itemId" JOIN "PurchaseLine" pl ON ip."purchaseLineId"=pl."id" WHERE pl."orderId"=p."orderId")
  THEN RAISE EXCEPTION 'joint restore cannot split purchase state or bypass current whole-order financial facts' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM "ItemPurchaseLink" WHERE "itemId"=i."id") OR NEW."restoredSnapshot"->'purchaseLine' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'joint restore has an unexpected purchase anchor' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Correction_restore_joint" AFTER INSERT OR UPDATE ON "IngestConfirmationCorrection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tome_correction_restore_joint();
