/*
  Warnings:

  - You are about to drop the column `invoiceDate` on the `invoices` table. All the data in the column will be lost.
  - Added the required column `issueDate` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `legalMonetaryTotal` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taxTotal` to the `invoices` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "invoiceDate",
ADD COLUMN     "accountingCost" TEXT,
ADD COLUMN     "actualDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "allowanceCharges" JSONB,
ADD COLUMN     "billingReference" JSONB,
ADD COLUMN     "buyerReference" TEXT,
ADD COLUMN     "documentReferences" JSONB,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "invoiceDeliveryPeriod" JSONB,
ADD COLUMN     "issueDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "legalMonetaryTotal" JSONB NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "orderReference" TEXT,
ADD COLUMN     "paymentMeans" JSONB,
ADD COLUMN     "paymentTermsNote" TEXT,
ADD COLUMN     "sourceReference" TEXT,
ADD COLUMN     "taxCurrencyCode" TEXT,
ADD COLUMN     "taxPointDate" TIMESTAMP(3),
ADD COLUMN     "taxTotal" JSONB NOT NULL,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "schemaVersion" SET DEFAULT '2.0';

-- CreateIndex
CREATE INDEX "invoices_issueDate_idx" ON "invoices"("issueDate");

-- CreateIndex
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");
