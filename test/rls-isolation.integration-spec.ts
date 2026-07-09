/**
 * Cross-tenant RLS isolation test (AC4).
 *
 * Verifies that Postgres FORCE ROW LEVEL SECURITY correctly prevents one
 * tenant from reading another tenant's rows when connecting as the
 * non-owner billinx_app role.
 *
 * This test MUST:
 *   FAIL  on an unpatched database (no FORCE ROW LEVEL SECURITY or no billinx_app role).
 *   PASS  after migration 20260709000000_enforce_rls_and_app_role is applied.
 *
 * Why two connections:
 *   ownerPrisma  (billinx / MIGRATION_DATABASE_URL) — superuser; used only for
 *                setup and cleanup where row_security bypass is acceptable.
 *   appPrisma    (billinx_app / APP_DATABASE_URL)   — non-owner, non-superuser;
 *                subject to FORCE ROW LEVEL SECURITY policies. This is the
 *                role that the running application should use in production.
 *
 * It mirrors what PrismaService.applyRlsExtension() does at runtime:
 * set_config and the query are batched into the same $transaction([...])
 * so that set_config(is_local=true) persists for the duration of the query.
 *
 * Requirements:
 *   DATABASE_URL / MIGRATION_DATABASE_URL — owner-role connection (for setup).
 *   APP_DATABASE_URL (optional)           — billinx_app connection.
 *     If APP_DATABASE_URL is not set the test constructs it from DATABASE_URL
 *     by substituting the user and password (dev convention only).
 *   The migration must already be applied before running this suite.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
// In CI the workflow sets APP_DATABASE_URL explicitly.
// In local dev default to the dev password from the migration.
const APP_URL =
  process.env.APP_DATABASE_URL ??
  (OWNER_URL
    ? OWNER_URL.replace(
        /\/\/[^:]+:[^@]+@/,
        '//billinx_app:billinx_app_dev_CHANGE_IN_PROD@',
      )
    : undefined);

const TENANT_A_ID = '00000000-aa00-0000-0000-000000000001';
const TENANT_B_ID = '00000000-bb00-0000-0000-000000000002';
const INVOICE_ID = '00000000-cccc-0000-0000-000000000001';

describe('RLS cross-tenant isolation', () => {
  let ownerPrisma: PrismaClient;
  let appPrisma: PrismaClient;

  beforeAll(async () => {
    if (!OWNER_URL || !APP_URL) {
      pending('DATABASE_URL not set — skipping RLS integration test');
      return;
    }

    ownerPrisma = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
    appPrisma = new PrismaClient({ datasources: { db: { url: APP_URL } } });

    await ownerPrisma.$connect();
    await appPrisma.$connect();

    // Upsert test tenants as owner (tenants table has no RLS policy).
    await ownerPrisma.$executeRaw`
      INSERT INTO tenants (
        id, name, tin, "registeredAddress", "appAdapterKey",
        environment, "rateLimitTier", "batchEnabled", "batchSize",
        "isActive", "inventoryEnabled", "dashboardVisibility",
        "createdAt", "updatedAt"
      )
      VALUES
        (${Prisma.sql`${TENANT_A_ID}::uuid`},
         'RLS Test Tenant A', '99999999-0001',
         '{}', 'mock', 'SANDBOX'::"TenantEnvironment", 'STANDARD'::"RateLimitTier",
         false, 100, true, false, '{}', now(), now()),
        (${Prisma.sql`${TENANT_B_ID}::uuid`},
         'RLS Test Tenant B', '99999999-0002',
         '{}', 'mock', 'SANDBOX'::"TenantEnvironment", 'STANDARD'::"RateLimitTier",
         false, 100, true, false, '{}', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    // Insert one invoice belonging to TENANT_A as owner.
    // Our RLS policies have no WITH CHECK clause so INSERT is not filtered
    // by row_security regardless of which connection is used.
    await ownerPrisma.$executeRaw`
      INSERT INTO invoices (
        id, "tenantId", environment, "invoiceTypeCode", "platformIrn",
        "sellerTin", "sellerName", "buyerName", "issueDate",
        subtotal, "vatAmount", "totalAmount",
        "lineItems", "taxTotal", "legalMonetaryTotal",
        status, "isArchived", "amountPaid", "isOverdue",
        "reminderCount", "whtApplicable", "createdAt", "updatedAt",
        "schemaVersion"
      )
      VALUES (
        ${Prisma.sql`${INVOICE_ID}::uuid`},
        ${Prisma.sql`${TENANT_A_ID}::uuid`},
        'SANDBOX'::"TenantEnvironment",
        'STANDARD'::"InvoiceTypeCode",
        'RLS-TEST-IRN-0001',
        'AA-000000001', 'Seller A', 'Buyer X', now(),
        100.00, 7.50, 107.50,
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        'DRAFT'::"InvoiceStatus",
        false, 0, false, 0, false, now(), now(), '2.0'
      )
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (!ownerPrisma) return;
    await ownerPrisma.$executeRaw`DELETE FROM invoices WHERE id::text = ${INVOICE_ID}`;
    await ownerPrisma.$executeRaw`
      DELETE FROM tenants WHERE id::text IN (${TENANT_A_ID}, ${TENANT_B_ID})
    `;
    await ownerPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  // All three assertions use appPrisma (billinx_app: non-owner, non-superuser)
  // so that FORCE ROW LEVEL SECURITY actually applies.

  it('tenant B context cannot read tenant A rows (AC4)', async () => {
    // Simulate what PrismaService.applyRlsExtension() does at runtime:
    // issue set_config and SELECT in the SAME $transaction so the GUC
    // value is visible to the RLS policy when the query executes.
    const [, rows] = await appPrisma.$transaction([
      appPrisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${TENANT_B_ID}, true)`,
      appPrisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM invoices WHERE id::text = ${INVOICE_ID}
      `,
    ]);

    // With FORCE ROW LEVEL SECURITY applied and billinx_app as the session
    // user: the policy filters tenant A's invoice because
    // TENANT_B_ID ≠ invoice tenantId → 0 rows. ✓
    //
    // Without FORCE, or when connecting as the superuser: the policy is
    // bypassed → 1 row → assertion fails → surfaces the security gap.
    expect(rows).toHaveLength(0);
  });

  it('tenant A context can read its own rows (sanity check)', async () => {
    const [, rows] = await appPrisma.$transaction([
      appPrisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${TENANT_A_ID}, true)`,
      appPrisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM invoices WHERE id::text = ${INVOICE_ID}
      `,
    ]);

    expect(rows).toHaveLength(1);
    expect((rows as { id: string }[])[0].id).toBe(INVOICE_ID);
  });

  it('no tenant context returns 0 rows (defence-in-depth)', async () => {
    // current_setting returns '' when not set; '' ≠ any UUID → no rows.
    const [, rows] = await appPrisma.$transaction([
      appPrisma.$executeRaw`SELECT set_config('app.current_tenant_id', '', true)`,
      appPrisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM invoices WHERE id::text = ${INVOICE_ID}
      `,
    ]);

    expect(rows).toHaveLength(0);
  });
});
