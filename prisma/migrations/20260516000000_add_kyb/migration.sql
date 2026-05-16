-- CreateEnum
CREATE TYPE "KybRiskScore" AS ENUM ('PENDING', 'GREEN', 'AMBER', 'RED');

-- AlterTable: add KYB fields to access_requests
ALTER TABLE "access_requests"
  ADD COLUMN "cacRcNumber" TEXT,
  ADD COLUMN "kybScore"    "KybRiskScore" NOT NULL DEFAULT 'PENDING';

-- CreateTable: kyb_verifications
CREATE TABLE "kyb_verifications" (
  "id"                  TEXT NOT NULL,
  "accessRequestId"     TEXT NOT NULL,
  "tenantId"            TEXT,

  "tin"                 TEXT NOT NULL,
  "tinUserConfirmed"    BOOLEAN NOT NULL DEFAULT false,
  "tinConfirmedAt"      TIMESTAMP(3),
  "tinConfirmedIp"      TEXT,
  "tinProofNote"        TEXT,

  "cacRcNumber"         TEXT,
  "cacVerified"         BOOLEAN NOT NULL DEFAULT false,
  "cacVerifiedAt"       TIMESTAMP(3),
  "cacCompanyName"      TEXT,
  "cacStatus"           TEXT,
  "cacRegistrationDate" TEXT,
  "cacDirectors"        JSONB,
  "cacRawResponse"      JSONB,
  "cacErrorMessage"     TEXT,

  "nameMatchScore"      DOUBLE PRECISION,
  "nameMatchResult"     TEXT,

  "riskScore"           "KybRiskScore" NOT NULL DEFAULT 'PENDING',
  "riskReasons"         JSONB,

  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "kyb_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyb_verifications_accessRequestId_key"
  ON "kyb_verifications"("accessRequestId");

-- AddForeignKey
ALTER TABLE "kyb_verifications"
  ADD CONSTRAINT "kyb_verifications_accessRequestId_fkey"
  FOREIGN KEY ("accessRequestId") REFERENCES "access_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
