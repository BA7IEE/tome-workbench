-- Distribution foundation is additive. Historical migrations and facts remain untouched.

ALTER TABLE "Channel"
  ADD COLUMN "defaultCurrency" TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN "distributionMode" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "endpointUrl" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Sale"
  ADD COLUMN "channelId" UUID,
  ADD COLUMN "inquiryId" UUID;

ALTER TABLE "Inquiry"
  ADD COLUMN "channelId" UUID;

CREATE TABLE "ChannelPrice" (
  "id" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChannelPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelPrice_amount_nonnegative" CHECK ("amount" >= 0),
  CONSTRAINT "ChannelPrice_currency_supported" CHECK ("currency" IN ('CNY','USD','EUR','HKD','GBP','SGD')),
  CONSTRAINT "ChannelPrice_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ChannelPrice_itemId_channelId_key" ON "ChannelPrice"("itemId", "channelId");
CREATE INDEX "ChannelPrice_channelId_idx" ON "ChannelPrice"("channelId");

CREATE TABLE "DistributionSession" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "agentName" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DistributionSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DistributionSession_token_hash_valid" CHECK (length("tokenHash") = 64)
);

CREATE UNIQUE INDEX "DistributionSession_tokenHash_key" ON "DistributionSession"("tokenHash");
CREATE INDEX "DistributionSession_channelId_expiresAt_idx" ON "DistributionSession"("channelId", "expiresAt");

CREATE TABLE "DistributionAttempt" (
  "id" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "packageId" UUID,
  "action" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "dedupeKey" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL DEFAULT '',
  "remoteUrl" TEXT NOT NULL DEFAULT '',
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "errorCode" TEXT NOT NULL DEFAULT '',
  "errorMessage" TEXT NOT NULL DEFAULT '',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimedBySessionId" UUID,
  "leaseUntil" TIMESTAMP(3),
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DistributionAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DistributionAttempt_action_valid" CHECK ("action" IN ('PUBLISH','UPDATE','DELIST','VERIFY')),
  CONSTRAINT "DistributionAttempt_state_valid" CHECK ("state" IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
  CONSTRAINT "DistributionAttempt_count_nonnegative" CHECK ("attemptCount" >= 0),
  CONSTRAINT "DistributionAttempt_no_manual_remote_id" CHECK ("remoteId" = '' OR "remoteId" !~* '^MANUAL:')
);

CREATE UNIQUE INDEX "DistributionAttempt_dedupeKey_key" ON "DistributionAttempt"("dedupeKey");
CREATE INDEX "DistributionAttempt_channelId_state_createdAt_idx" ON "DistributionAttempt"("channelId", "state", "createdAt");
CREATE INDEX "DistributionAttempt_itemId_channelId_createdAt_idx" ON "DistributionAttempt"("itemId", "channelId", "createdAt");

ALTER TABLE "ChannelPrice"
  ADD CONSTRAINT "ChannelPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChannelPrice_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DistributionSession"
  ADD CONSTRAINT "DistributionSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DistributionAttempt"
  ADD CONSTRAINT "DistributionAttempt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DistributionAttempt_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DistributionAttempt_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "UsePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DistributionAttempt_claimedBySessionId_fkey" FOREIGN KEY ("claimedBySessionId") REFERENCES "DistributionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Sale_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Inquiry"
  ADD CONSTRAINT "Inquiry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Sale_inquiryId_key" ON "Sale"("inquiryId");
