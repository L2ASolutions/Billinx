-- CreateEnum
CREATE TYPE "ProductItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- AlterTable: ProductCatalog — add SERVICE-line-item classification fields
ALTER TABLE "product_catalog"
  ADD COLUMN "itemType"        "ProductItemType" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "isicCode"        TEXT,
  ADD COLUMN "serviceCategory" TEXT;
