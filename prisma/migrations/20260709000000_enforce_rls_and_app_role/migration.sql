-- ============================================================================
-- Enforce RLS with FORCE and create non-owner application role
--
-- Two root-cause fixes for the tenant isolation gap identified in the
-- 2026-07-09 enterprise readiness audit:
--
-- (1) FORCE ROW LEVEL SECURITY on every tenant-scoped table.
--     The original RLS migration (20260517120000) used ENABLE but not FORCE.
--     Without FORCE, the table owner (billinx — a superuser) bypasses all
--     policies silently, making every RLS policy inert while connecting as
--     that role.
--
-- (2) A non-owner application role billinx_app with DML-only permissions.
--     The runtime DATABASE_URL should connect as billinx_app so that ENABLE
--     ROW LEVEL SECURITY (without FORCE) is already sufficient — FORCE is
--     added as defence-in-depth against future owner-role reconnections.
--     Migrations and admin runtime operations must use MIGRATION_DATABASE_URL
--     (the owner role) because SET LOCAL row_security = OFF requires superuser.
--
-- Tables receiving FORCE ROW LEVEL SECURITY (already had ENABLE from the
-- original migration — 14 tables):
--   api_keys, refresh_tokens, idempotency_records, invoices,
--   invoice_state_history, submission_attempts, webhook_subscriptions,
--   webhook_deliveries, users, user_roles, user_invitations,
--   audit_logs, activity_events, system_errors
--
-- Tables receiving ENABLE + FORCE + new policy (added after 2026-05-17 or
-- omitted from the original migration despite having a tenantId column):
--   product_catalog, bulk_batches, payment_records, reminder_rules,
--   reminder_logs, incoming_invoices, vat_entries, vat_period_summaries,
--   stock_movements, clients, credit_notes, notifications, user_preferences,
--   erasure_requests, consent_records (nullable), kyb_verifications (nullable)
-- ============================================================================


-- ── Part 1: FORCE ROW LEVEL SECURITY on tables already protected by ENABLE ───
-- These already have policies from 20260517120000_add_row_level_security.
-- FORCE makes the policy apply even when the session user is the table owner.

ALTER TABLE api_keys              FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records   FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices              FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_state_history FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_attempts   FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    FORCE ROW LEVEL SECURITY;
ALTER TABLE users                 FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE user_invitations      FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_events       FORCE ROW LEVEL SECURITY;
ALTER TABLE system_errors         FORCE ROW LEVEL SECURITY;


-- ── Part 2: ENABLE + FORCE + policy for tenant-scoped tables with no RLS yet ─
-- All use the same policy shape as the original migration.
-- Non-null tenantId tables: strict equality check.
-- Nullable tenantId tables: NULL-inclusive policy so admin-only rows with
-- tenantId IS NULL are still reachable via SET LOCAL row_security = OFF.

ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalog FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_catalog
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE bulk_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_batches FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bulk_batches
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_records
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_rules FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reminder_rules
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_logs FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reminder_logs
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE incoming_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_invoices FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incoming_invoices
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE vat_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_entries FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vat_entries
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE vat_period_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_period_summaries FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vat_period_summaries
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clients
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_notes
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_preferences
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- erasure_requests has non-null tenantId but was excluded from the original
-- migration. Add policy now.
ALTER TABLE erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE erasure_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erasure_requests
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- consent_records and kyb_verifications have nullable tenantId; rows with
-- tenantId IS NULL are admin-only and visible only when row_security = OFF.
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_records
  USING (
    "tenantId" IS NULL OR
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );

ALTER TABLE kyb_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_verifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kyb_verifications
  USING (
    "tenantId" IS NULL OR
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );


-- ── Part 3: Non-owner application role ───────────────────────────────────────
-- billinx_app connects as the app runtime user. It has DML (no DDL) on all
-- tables the application touches. Migrations and admin operations that require
-- SET LOCAL row_security = OFF must use the owner role via MIGRATION_DATABASE_URL.
--
-- In production: set a strong password with
--   ALTER ROLE billinx_app WITH PASSWORD 'your-strong-random-password';
-- then update DATABASE_URL to postgresql://billinx_app:<pwd>@host/billinx.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles WHERE rolname = 'billinx_app'
  ) THEN
    -- Dev placeholder password — MUST be changed before production use.
    CREATE ROLE billinx_app WITH LOGIN PASSWORD 'billinx_app_dev_CHANGE_IN_PROD';
  END IF;
END
$$;

-- Database-level access
DO $$
DECLARE db text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO billinx_app', db);
END
$$;

GRANT USAGE ON SCHEMA public TO billinx_app;

-- Tenant-scoped tables: full DML, no DDL
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  api_keys,
  refresh_tokens,
  idempotency_records,
  invoices,
  invoice_state_history,
  submission_attempts,
  webhook_subscriptions,
  webhook_deliveries,
  users,
  user_roles,
  user_invitations,
  user_preferences,
  audit_logs,
  activity_events,
  system_errors,
  product_catalog,
  bulk_batches,
  payment_records,
  reminder_rules,
  reminder_logs,
  incoming_invoices,
  incoming_invoice_items,
  vat_entries,
  vat_period_summaries,
  stock_movements,
  clients,
  credit_notes,
  notifications
TO billinx_app;

-- Admin / cross-tenant tables the app reads or writes during normal operations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  tenants,
  admin_users,
  admin_keys,
  access_requests,
  kyb_verifications,
  password_reset_tokens,
  consent_records,
  erasure_requests
TO billinx_app;

-- Reference-data tables: read-only for the app role
GRANT SELECT ON TABLE
  invoice_types,
  payment_means,
  tax_categories,
  currencies,
  hs_codes,
  service_codes,
  nigerian_states,
  lgas,
  countries,
  quantity_codes
TO billinx_app;

-- Sequence grants (needed if any table ever uses SERIAL/BIGSERIAL in future)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billinx_app;
