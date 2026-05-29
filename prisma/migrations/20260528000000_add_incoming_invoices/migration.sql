-- CreateEnum
CREATE TYPE "IncomingInvoiceStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'REJECTED', 'APPROVED', 'PAID');

-- AlterEnum
ALTER TYPE "ActivityEventType" ADD VALUE 'INCOMING_INVOICE_RECEIVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INCOMING_INVOICE_VALIDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INCOMING_INVOICE_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INCOMING_INVOICE_REJECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INCOMING_INVOICE_PAID';

-- CreateTable
CREATE TABLE "incoming_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierTin" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "IncomingInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "description" TEXT,
    "sourceReference" TEXT,
    "rawPayload" JSONB,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_invoice_items" (
    "id" TEXT NOT NULL,
    "incomingInvoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "lineAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "hsnCode" TEXT,

    CONSTRAINT "incoming_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incoming_invoices_tenantId_idx" ON "incoming_invoices"("tenantId");

-- CreateIndex
CREATE INDEX "incoming_invoices_tenantId_status_idx" ON "incoming_invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "incoming_invoices_supplierTin_idx" ON "incoming_invoices"("supplierTin");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_invoices_tenantId_invoiceNumber_supplierTin_key" ON "incoming_invoices"("tenantId", "invoiceNumber", "supplierTin");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_incomingInvoiceId_idx" ON "incoming_invoice_items"("incomingInvoiceId");

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoice_items" ADD CONSTRAINT "incoming_invoice_items_incomingInvoiceId_fkey" FOREIGN KEY ("incomingInvoiceId") REFERENCES "incoming_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
