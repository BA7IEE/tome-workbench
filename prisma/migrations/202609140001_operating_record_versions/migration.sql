ALTER TABLE "Inquiry" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Channel" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Inquiry" ADD CONSTRAINT "inquiry_version_positive" CHECK ("version" > 0);
ALTER TABLE "Channel" ADD CONSTRAINT "channel_version_positive" CHECK ("version" > 0);
