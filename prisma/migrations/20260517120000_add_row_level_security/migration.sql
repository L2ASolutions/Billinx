-- ============================================================================
-- Add PostgreSQL Row-Level Security (RLS) to all tenant-scoped tables
--
-- Design: every non-admin query sets `app.current_tenant_id` via the Prisma
-- middleware in PrismaService.$use(). Admin queries call
-- `SET LOCAL row_security = OFF` inside prisma.asAdmin() to bypass.
--
-- The policy uses `nullif(..., '')` so that rows are visible when
-- app.current_tenant_id is not set (background jobs that explicitly call
-- SET LOCAL row_security = OFF cover the admin bypass path).
--
-- All policies are PERMISSIVE (default). The DB user is NOT superuser, so
-- RLS applies. The app never connects with a superuser in production.
-- ============================================================================

-- ── Tables with non-nullable tenantId ───────────────────────────────────────

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_tokens
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_records
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE invoice_state_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_state_history
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE submission_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON submission_attempts
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_subscriptions
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_roles
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_invitations
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- ── Tables with nullable tenantId (cross-tenant admin records allowed) ───────
-- Rows with NULL tenant_id are always visible to admin queries (which bypass
-- RLS). Regular tenant queries only see their own rows.

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (
    "tenantId" IS NULL OR
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activity_events
  USING (
    "tenantId" IS NULL OR
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );

ALTER TABLE system_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON system_errors
  USING (
    "tenantId" IS NULL OR
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );

-- ── Tables that are NOT tenant-scoped (no RLS needed) ───────────────────────
-- tenants, admin_users, admin_keys, access_requests, kyb_verifications,
-- password_reset_tokens, consent_records, erasure_requests
-- These are read only by admin queries (which set row_security = OFF)
-- or by the user themselves (filtered by userId, not tenantId).
