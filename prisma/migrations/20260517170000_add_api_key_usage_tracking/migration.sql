-- AlterTable: add request tracking columns to api_keys
ALTER TABLE "api_keys"
  ADD COLUMN "lastUsedIp"   TEXT,
  ADD COLUMN "requestCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex: for efficient expiry queries (expiry notifications cron)
CREATE INDEX "api_keys_expiresAt_idx" ON "api_keys"("expiresAt");
