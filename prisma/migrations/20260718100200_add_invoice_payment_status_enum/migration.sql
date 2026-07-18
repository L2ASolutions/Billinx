-- CreateEnum
CREATE TYPE "PaymentStatusType" AS ENUM ('PENDING', 'PAID', 'PARTIAL');

-- Backfill: paymentStatus was a free-text nullable column. Normalise every
-- existing non-conforming value (NULL, '', 'UNPAID', 'OVERDUE', or anything
-- else outside the new enum) to 'PENDING' before the type cast below, so the
-- cast can never fail on a row this migration doesn't already know how to
-- handle.
UPDATE "invoices"
SET "paymentStatus" = 'PENDING'
WHERE "paymentStatus" IS NULL
   OR "paymentStatus" NOT IN ('PENDING', 'PAID', 'PARTIAL');

-- AlterTable: Invoice.paymentStatus String? -> PaymentStatusType NOT NULL DEFAULT PENDING
ALTER TABLE "invoices"
  ALTER COLUMN "paymentStatus" TYPE "PaymentStatusType" USING ("paymentStatus"::"PaymentStatusType"),
  ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING',
  ALTER COLUMN "paymentStatus" SET NOT NULL;
