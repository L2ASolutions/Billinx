-- AlterTable: Invoice — track the outcome of the last NRS UpdateStatus call
-- (see submission/queues/update-status.queue.ts)
ALTER TABLE "invoices"
  ADD COLUMN "lastNrsStatusUpdateAt"      TIMESTAMP(3),
  ADD COLUMN "lastNrsStatusUpdateSuccess" BOOLEAN;
