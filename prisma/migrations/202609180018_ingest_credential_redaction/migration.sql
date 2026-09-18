-- Ingest session credentials are one-time secrets. Older code stored the
-- create-session command response verbatim in Receipt, including plaintext
-- token. Preserve id/source/expiry evidence while permanently removing the
-- credential from historical receipts.

UPDATE "Receipt"
SET "response" =
  ("response"::jsonb - 'token') ||
  jsonb_build_object('tokenIssued', true)
WHERE "operation" = 'ingest.session.create'
  AND jsonb_typeof("response"::jsonb) = 'object'
  AND ("response"::jsonb ? 'token');
