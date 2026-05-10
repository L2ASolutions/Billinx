-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'INVOICE_CREATED', 'INVOICE_VALIDATED', 'INVOICE_SUBMITTED', 'INVOICE_ACCEPTED', 'INVOICE_REJECTED', 'INVOICE_CANCELLED', 'INVOICE_VIEWED', 'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_DEACTIVATED', 'WEBHOOK_DELIVERED', 'WEBHOOK_FAILED', 'EXPORT_GENERATED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'USER_CREATED', 'USER_DEACTIVATED', 'PASSWORD_RESET', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "eventType" "ActivityEventType" NOT NULL,
    "actor" TEXT NOT NULL,
    "actorEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_errors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "errorCode" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "stackTrace" TEXT,
    "endpoint" TEXT,
    "method" TEXT,
    "actor" TEXT,
    "requestId" TEXT,
    "severity" "ErrorSeverity" NOT NULL DEFAULT 'LOW',
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_events_tenantId_occurredAt_idx" ON "activity_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_events_tenantId_eventType_idx" ON "activity_events"("tenantId", "eventType");

-- CreateIndex
CREATE INDEX "activity_events_entityId_idx" ON "activity_events"("entityId");

-- CreateIndex
CREATE INDEX "system_errors_isResolved_severity_idx" ON "system_errors"("isResolved", "severity");

-- CreateIndex
CREATE INDEX "system_errors_tenantId_occurredAt_idx" ON "system_errors"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_errors" ADD CONSTRAINT "system_errors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
