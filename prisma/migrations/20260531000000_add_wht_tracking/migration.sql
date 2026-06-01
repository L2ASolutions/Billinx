-- Migration: add WHT tracking fields to invoices, incoming_invoices, payment_records

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "whtApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "whtRate" DECIMAL,
  ADD COLUMN IF NOT EXISTS "whtAmount" DECIMAL,
  ADD COLUMN IF NOT EXISTS "expectedCash" DECIMAL;

ALTER TABLE "incoming_invoices"
  ADD COLUMN IF NOT EXISTS "whtApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "whtRate" DECIMAL,
  ADD COLUMN IF NOT EXISTS "whtAmount" DECIMAL,
  ADD COLUMN IF NOT EXISTS "netPayable" DECIMAL;

ALTER TABLE "payment_records"
  ADD COLUMN IF NOT EXISTS "whtDeducted" DECIMAL;
