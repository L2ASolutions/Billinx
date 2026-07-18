-- AlterTable: ApiKey — per-key scopes (default ["*"] = full access, matching
-- every key's existing behaviour so pre-existing keys are unaffected).
ALTER TABLE "api_keys" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['*']::TEXT[];
