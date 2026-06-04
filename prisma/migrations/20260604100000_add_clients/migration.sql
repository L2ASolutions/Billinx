-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tin" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "businessDescription" TEXT,
    "contactPerson" TEXT,
    "notes" TEXT,
    "postalAddress" JSONB,
    "totalInvoices" INTEGER NOT NULL DEFAULT 0,
    "totalBilled" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastInvoiceAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_tenantId_idx" ON "clients"("tenantId");

-- CreateIndex
CREATE INDEX "clients_tenantId_companyName_idx" ON "clients"("tenantId", "companyName");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "clients_tenantId_tin_key" ON "clients"("tenantId", "tin");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add new ActivityEventType values
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'CLIENT_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'CLIENT_UPDATED';
