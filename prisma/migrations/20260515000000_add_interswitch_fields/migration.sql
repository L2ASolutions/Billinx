-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('B2B', 'B2C', 'B2G');

-- AlterTable: Invoice — add invoiceKind, issueTime, paymentStatus
ALTER TABLE "invoices"
  ADD COLUMN "invoiceKind"   "InvoiceKind",
  ADD COLUMN "issueTime"     TEXT,
  ADD COLUMN "paymentStatus" TEXT;

-- AlterTable: Tenant — add Interswitch credential fields
ALTER TABLE "tenants"
  ADD COLUMN "interswitchClientId"     TEXT,
  ADD COLUMN "interswitchClientSecret" BYTEA,
  ADD COLUMN "interswitchSecretIv"     BYTEA,
  ADD COLUMN "interswitchServiceId"    TEXT,
  ADD COLUMN "interswitchBusinessId"   TEXT;
