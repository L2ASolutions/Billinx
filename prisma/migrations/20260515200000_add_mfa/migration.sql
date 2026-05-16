-- Add MFA fields to users table
ALTER TABLE "users"
  ADD COLUMN "mfaEnabled"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecret"      BYTEA,
  ADD COLUMN "mfaSecretIv"    BYTEA,
  ADD COLUMN "mfaBackupCodes" JSONB;
