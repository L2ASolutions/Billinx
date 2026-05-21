-- AlterTable: add payment tracking fields to invoices
ALTER TABLE "invoices" ADD COLUMN "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "paymentDueDate" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "isOverdue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN "overdueAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "lastReminderAt" TIMESTAMP(3);

-- CreateIndex for paymentDueDate (overdue cron needs this)
CREATE INDEX "invoices_paymentDueDate_idx" ON "invoices"("paymentDueDate");

-- CreateTable: payment_records
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "paymentReference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_records_invoiceId_idx" ON "payment_records"("invoiceId");
CREATE INDEX "payment_records_tenantId_idx" ON "payment_records"("tenantId");
CREATE INDEX "payment_records_tenantId_paidAt_idx" ON "payment_records"("tenantId", "paidAt");

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum: add new ActivityEventType values
ALTER TYPE "ActivityEventType" ADD VALUE 'PAYMENT_RECORDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INVOICE_OVERDUE';
