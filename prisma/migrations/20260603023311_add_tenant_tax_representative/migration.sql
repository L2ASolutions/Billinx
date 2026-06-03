/*
  Warnings:

  - You are about to alter the column `whtRate` on the `incoming_invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `whtAmount` on the `incoming_invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `netPayable` on the `incoming_invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `whtRate` on the `invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `whtAmount` on the `invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `expectedCash` on the `invoices` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `whtDeducted` on the `payment_records` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- AlterTable
ALTER TABLE "incoming_invoices" ALTER COLUMN "whtRate" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "whtAmount" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "netPayable" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "whtRate" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "whtAmount" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "expectedCash" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "payment_records" ALTER COLUMN "whtDeducted" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "taxRepresentative" JSONB;
