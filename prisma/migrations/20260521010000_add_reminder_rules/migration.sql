-- CreateEnum
CREATE TYPE "ReminderTriggerType" AS ENUM ('DAYS_BEFORE_DUE', 'ON_DUE_DATE', 'DAYS_AFTER_DUE');

-- Add REMINDER_SENT to ActivityEventType enum
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'REMINDER_SENT';

-- CreateTable: reminder_rules
CREATE TABLE "reminder_rules" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "triggerType"     "ReminderTriggerType" NOT NULL,
    "triggerDays"     INTEGER NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "reminderMessage" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: reminder_logs
CREATE TABLE "reminder_logs" (
    "id"               TEXT NOT NULL,
    "invoiceId"        TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "ruleId"           TEXT NOT NULL,
    "sentAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSentTo"      TEXT NOT NULL,
    "webhookDelivered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_rules_tenantId_idx" ON "reminder_rules"("tenantId");
CREATE INDEX "reminder_rules_tenantId_isActive_idx" ON "reminder_rules"("tenantId", "isActive");
CREATE INDEX "reminder_logs_tenantId_idx" ON "reminder_logs"("tenantId");
CREATE INDEX "reminder_logs_invoiceId_idx" ON "reminder_logs"("invoiceId");
CREATE UNIQUE INDEX "reminder_logs_invoiceId_ruleId_key" ON "reminder_logs"("invoiceId", "ruleId");

-- AddForeignKey
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "reminder_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
