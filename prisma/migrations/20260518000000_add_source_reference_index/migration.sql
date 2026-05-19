-- Add index on (tenantId, sourceReference) for efficient duplicate detection
-- sourceReference column already exists from the initial migration

CREATE INDEX "invoices_tenantId_sourceReference_idx" ON "invoices"("tenantId", "sourceReference");
