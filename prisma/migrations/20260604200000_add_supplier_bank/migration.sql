-- Add supplier contact + bank details
ALTER TABLE "incoming_invoices"
  ADD COLUMN IF NOT EXISTS "supplierEmail"       TEXT,
  ADD COLUMN IF NOT EXISTS "supplierBankName"    TEXT,
  ADD COLUMN IF NOT EXISTS "supplierBankAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierBankAccName" TEXT;

-- Add payment record fields
ALTER TABLE "incoming_invoices"
  ADD COLUMN IF NOT EXISTS "amountPaid"       DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProvider"  TEXT,
  ADD COLUMN IF NOT EXISTS "paidAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentNotes"     TEXT;
