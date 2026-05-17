CREATE TABLE "product_catalog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "hsnCode" TEXT,
  "productCategory" TEXT,
  "unitPrice" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "taxCategoryId" TEXT NOT NULL DEFAULT 'STANDARD_VAT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_catalog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_catalog_tenantId_idx" ON "product_catalog"("tenantId");
CREATE INDEX "product_catalog_tenantId_isActive_idx" ON "product_catalog"("tenantId", "isActive");
ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
