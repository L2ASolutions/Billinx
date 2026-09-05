-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "screenshotKey" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "stackTrace" TEXT,
    "pageUrl" TEXT NOT NULL,
    "browserInfo" TEXT NOT NULL,
    "userDescription" TEXT,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_idx" ON "support_tickets"("tenantId");

-- CreateIndex
CREATE INDEX "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt");

-- ============================================================================
-- Row-level security, matching the ENABLE + FORCE + tenant_isolation policy
-- pattern established in 20260709000000_enforce_rls_and_app_role.
--
-- "tenantId" is nullable on this table (an unhandled crash can happen before
-- a user has authenticated, when no tenant context exists). The policy below
-- only matches rows where "tenantId" equals the caller's tenant GUC — a NULL
-- "tenantId" row is invisible to every tenant-scoped (RLS) query, by design.
-- Pre-auth ticket creation and every admin support-ticket endpoint go through
-- PrismaService.asAdmin() instead, which bypasses RLS entirely, exactly like
-- every other cross-tenant admin read/write in this codebase.
-- ============================================================================

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_tickets
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- billinx_app already exists by this point (created unconditionally in
-- 20260709000000_enforce_rls_and_app_role) in every environment this
-- migration runs against.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE support_tickets TO billinx_app;
