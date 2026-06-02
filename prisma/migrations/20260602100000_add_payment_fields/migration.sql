-- Add bank account details to tenants
ALTER TABLE "tenants" ADD COLUMN "bankName"        TEXT;
ALTER TABLE "tenants" ADD COLUMN "bankAccount"     TEXT;
ALTER TABLE "tenants" ADD COLUMN "bankAccountName" TEXT;

-- Add payment link and buyer email to invoices
ALTER TABLE "invoices" ADD COLUMN "paymentLink" TEXT;
ALTER TABLE "invoices" ADD COLUMN "buyerEmail"  TEXT;
