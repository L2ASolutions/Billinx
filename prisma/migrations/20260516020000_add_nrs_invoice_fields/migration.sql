-- Add NRS API credential columns to tenants table
ALTER TABLE "tenants"
  ADD COLUMN "nrsApiKey"      BYTEA,
  ADD COLUMN "nrsApiKeyIv"    BYTEA,
  ADD COLUMN "nrsApiSecret"   BYTEA,
  ADD COLUMN "nrsApiSecretIv" BYTEA;
