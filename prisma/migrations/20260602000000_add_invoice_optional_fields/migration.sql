-- Migration: add invoice optional fields and tenant contact fields

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "deliveryPeriodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryPeriodEnd"   TIMESTAMP(3);

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "telephone"           TEXT,
  ADD COLUMN IF NOT EXISTS "businessDescription" TEXT;
