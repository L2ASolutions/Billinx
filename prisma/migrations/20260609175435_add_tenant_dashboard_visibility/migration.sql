-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "dashboardVisibility" JSONB NOT NULL DEFAULT '{}';
