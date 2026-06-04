-- AlterTable: Add inventoryEnabled to tenants
ALTER TABLE "tenants" ADD COLUMN "inventoryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add inventory fields to product_catalog
ALTER TABLE "product_catalog"
  ADD COLUMN "stockQuantity"   DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "reorderPoint"    DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "reorderQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "stockUnit"       TEXT,
  ADD COLUMN "supplierName"    TEXT,
  ADD COLUMN "supplierEmail"   TEXT,
  ADD COLUMN "lastRestockedAt" TIMESTAMP(3);

-- CreateEnum: StockMovementType
CREATE TYPE "StockMovementType" AS ENUM ('SALE', 'PURCHASE', 'ADJUSTMENT', 'OPENING', 'RETURN', 'WRITE_OFF');

-- AlterEnum: Add new ActivityEventType values
ALTER TYPE "ActivityEventType" ADD VALUE 'STOCK_ADJUSTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'STOCK_DEPLETED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REORDER_TRIGGERED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REORDER_REQUEST_SENT';

-- CreateTable: stock_movements
CREATE TABLE "stock_movements" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "type"          "StockMovementType" NOT NULL,
  "quantity"      DECIMAL(65,30) NOT NULL,
  "balanceBefore" DECIMAL(65,30) NOT NULL,
  "balanceAfter"  DECIMAL(65,30) NOT NULL,
  "referenceType" TEXT,
  "referenceId"   TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_tenantId_idx" ON "stock_movements"("tenantId");
CREATE INDEX "stock_movements_productId_idx" ON "stock_movements"("productId");
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "product_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
