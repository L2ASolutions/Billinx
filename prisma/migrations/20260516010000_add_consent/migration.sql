-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS_AND_PRIVACY', 'NDPR_DATA_PROCESSING', 'BUSINESS_AUTHORISATION');

-- CreateEnum
CREATE TYPE "ErasureRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: users — add erasure tracking fields
ALTER TABLE "users"
  ADD COLUMN "isErased"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "erasureRequestedAt" TIMESTAMP(3);

-- CreateTable: consent_records
CREATE TABLE "consent_records" (
  "id"             TEXT          NOT NULL,
  "userId"         TEXT,
  "tenantId"       TEXT,
  "email"          TEXT          NOT NULL,
  "consentType"    "ConsentType" NOT NULL,
  "consentVersion" TEXT          NOT NULL DEFAULT '1.0',
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "consentedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"      TIMESTAMP(3),
  "isRevoked"      BOOLEAN       NOT NULL DEFAULT false,
  "metadata"       JSONB,

  CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_records_userId_idx"      ON "consent_records"("userId");
CREATE INDEX "consent_records_tenantId_idx"    ON "consent_records"("tenantId");
CREATE INDEX "consent_records_email_idx"       ON "consent_records"("email");
CREATE INDEX "consent_records_consentType_idx" ON "consent_records"("consentType");

-- CreateTable: erasure_requests
CREATE TABLE "erasure_requests" (
  "id"          TEXT                   NOT NULL,
  "userId"      TEXT                   NOT NULL,
  "tenantId"    TEXT                   NOT NULL,
  "email"       TEXT                   NOT NULL,
  "status"      "ErasureRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedBy"  TEXT,
  "reviewedAt"  TIMESTAMP(3),
  "reviewNote"  TEXT,
  "erasedAt"    TIMESTAMP(3),

  CONSTRAINT "erasure_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "erasure_requests_userId_idx" ON "erasure_requests"("userId");
CREATE INDEX "erasure_requests_status_idx" ON "erasure_requests"("status");
