-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- DropForeignKey
ALTER TABLE "reminder_logs" DROP CONSTRAINT "reminder_logs_ruleId_fkey";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "recurringInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "templateData" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_invoices_tenantId_status_idx" ON "recurring_invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "recurring_invoices_status_nextRunDate_idx" ON "recurring_invoices"("status", "nextRunDate");

-- CreateIndex
CREATE INDEX "invoices_recurringInvoiceId_idx" ON "invoices"("recurringInvoiceId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "reminder_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Row-level security for the new tenant-scoped table, matching the
-- ENABLE + FORCE + tenant_isolation policy pattern established in
-- 20260709000000_enforce_rls_and_app_role for every other tenant table.
-- ============================================================================

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_invoices
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- billinx_app already exists by this point (created unconditionally in
-- 20260709000000_enforce_rls_and_app_role) in every environment this
-- migration runs against.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_invoices TO billinx_app;
