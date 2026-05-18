-- CreateEnum
CREATE TYPE "BulkBatchSource" AS ENUM ('JSON', 'CSV');

-- CreateTable
CREATE TABLE "bulk_batches" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "environment"  "TenantEnvironment" NOT NULL,
    "actor"        TEXT NOT NULL,
    "source"       "BulkBatchSource" NOT NULL DEFAULT 'JSON',
    "fileName"     TEXT,
    "total"        INTEGER NOT NULL,
    "queued"       INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "processing"   INTEGER NOT NULL DEFAULT 0,
    "accepted"     INTEGER NOT NULL DEFAULT 0,
    "rejected"     INTEGER NOT NULL DEFAULT 0,
    "failed"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_batches_tenantId_idx" ON "bulk_batches"("tenantId");

-- AddForeignKey
ALTER TABLE "bulk_batches" ADD CONSTRAINT "bulk_batches_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
