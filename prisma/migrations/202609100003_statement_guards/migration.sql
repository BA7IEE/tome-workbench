-- Forward-only integrity constraints for the new local accounting module.
-- This migration does not create transactions, activate rules, or transfer funds.
CREATE FUNCTION tome_rule_freeze_v3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'rule history is retained' USING ERRCODE='23514'; END IF;
 IF OLD."status"<>'DRAFT' OR NEW."status"<>'ACTIVE' OR
 (to_jsonb(OLD)-ARRAY['status','activatedAt','activatedBy']) IS DISTINCT FROM
 (to_jsonb(NEW)-ARRAY['status','activatedAt','activatedBy'])
 THEN RAISE EXCEPTION 'rule terms cannot be overwritten; create a new version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SettlementRule_terms_immutable" BEFORE UPDATE OR DELETE ON "SettlementRule" FOR EACH ROW EXECUTE FUNCTION tome_rule_freeze_v3();
CREATE FUNCTION tome_closed_currency_v3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."currency" IS DISTINCT FROM OLD."currency" AND EXISTS (
 SELECT 1 FROM "SettlementLine" l JOIN "SettlementStatement" s ON s."id"=l."statementId"
 WHERE l."saleId"=OLD."id" AND s."status"='CONFIRMED')
 THEN RAISE EXCEPTION 'confirmed statement currency cannot be reassigned' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Sale_confirmed_currency" BEFORE UPDATE OF "currency" ON "Sale" FOR EACH ROW EXECUTE FUNCTION tome_closed_currency_v3();
