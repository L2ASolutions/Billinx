-- AlterTable
ALTER TABLE "incoming_invoices"
  ADD COLUMN "attachmentData" BYTEA,
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMime" TEXT,
  ADD COLUMN "attachmentSize" INTEGER;
