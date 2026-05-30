-- CreateEnum
CREATE TYPE "VatType" AS ENUM ('OUTPUT', 'INPUT');

-- CreateEnum
CREATE TYPE "VatEntryStatus" AS ENUM ('UNRECONCILED', 'RECONCILED', 'DISPUTED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "VatPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'FILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'VAT_ENTRY_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'VAT_ENTRY_RECONCILED';
ALTER TYPE "ActivityEventType" ADD VALUE 'VAT_PERIOD_CLOSED';

-- CreateTable
CREATE TABLE "vat_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "VatType" NOT NULL,
    "invoiceId" TEXT,
    "incomingInvoiceId" TEXT,
    "supplierTin" TEXT,
    "buyerTin" TEXT,
    "taxableAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "vatRate" DECIMAL(65,30) NOT NULL DEFAULT 7.5,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "status" "VatEntryStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_period_summaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "outputVat" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inputVat" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netVat" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "outputCount" INTEGER NOT NULL DEFAULT 0,
    "inputCount" INTEGER NOT NULL DEFAULT 0,
    "unreconciledCount" INTEGER NOT NULL DEFAULT 0,
    "status" "VatPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_period_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vat_entries_tenantId_period_idx" ON "vat_entries"("tenantId", "period");

-- CreateIndex
CREATE INDEX "vat_entries_tenantId_type_idx" ON "vat_entries"("tenantId", "type");

-- CreateIndex
CREATE INDEX "vat_entries_tenantId_status_idx" ON "vat_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "vat_period_summaries_tenantId_idx" ON "vat_period_summaries"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "vat_period_summaries_tenantId_period_key" ON "vat_period_summaries"("tenantId", "period");

-- AddForeignKey
ALTER TABLE "vat_entries" ADD CONSTRAINT "vat_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_period_summaries" ADD CONSTRAINT "vat_period_summaries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
