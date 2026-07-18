-- AlterTable: ProductCatalog — add NRS price_unit code (default EA, matches
-- the InterswitchAdapter's own default for invoices with no product-catalog
-- source)
ALTER TABLE "product_catalog"
  ADD COLUMN "priceUnit" TEXT NOT NULL DEFAULT 'EA';
