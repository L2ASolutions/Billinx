-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "amountPaid" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "payment_records" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(65,30);

-- CreateIndex
CREATE INDEX "invoices_tenantId_createdAt_idx" ON "invoices"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_tenantId_isOverdue_idx" ON "invoices"("tenantId", "isOverdue");
