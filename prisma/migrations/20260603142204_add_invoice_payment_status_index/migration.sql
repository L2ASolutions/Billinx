-- CreateIndex
CREATE INDEX "invoices_tenantId_paymentStatus_idx" ON "invoices"("tenantId", "paymentStatus");
