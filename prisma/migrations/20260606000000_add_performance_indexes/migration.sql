-- AddIndex: Invoice(tenantId, issueDate)
CREATE INDEX IF NOT EXISTS "invoices_tenantId_issueDate_idx" ON "invoices"("tenantId", "issueDate");

-- AddIndex: IncomingInvoice(tenantId, createdAt)
CREATE INDEX IF NOT EXISTS "incoming_invoices_tenantId_createdAt_idx" ON "incoming_invoices"("tenantId", "createdAt");

-- AddIndex: Client(tenantId, totalInvoices)
CREATE INDEX IF NOT EXISTS "clients_tenantId_totalInvoices_idx" ON "clients"("tenantId", "totalInvoices");
