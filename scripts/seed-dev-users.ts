/**
 * Dev seed: creates an admin user and a test tenant with an OWNER user
 * and a VIEWER user (used by apps/web/e2e/).
 * Run with: npx ts-node scripts/seed-dev-users.ts
 * (or: npx tsx scripts/seed-dev-users.ts)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SecretsService } from '../src/infrastructure/secrets/secrets.service';
import { CredentialService } from '../src/modules/tenant/services/credential.service';

const prisma = new PrismaClient();
const secretsService = new SecretsService();
const credentialService = new CredentialService();

// OWNER/ADMIN logins always require MFA (UserService.login()'s isPrivileged
// check) — a fresh OWNER account with mfaEnabled=false gets mfaSetupRequired
// on every login and is redirected to /mfa/setup instead of /dashboard,
// which apps/web/e2e/helpers/auth.ts's loginAsOwner() can't complete without
// walking through the QR-based setup flow. Pre-enabling MFA here with a
// fixed, known TOTP secret lets loginAsOwner() go straight to the real
// challenge screen (/mfa) and compute a valid code via
// apps/web/e2e/helpers/totp.ts (a byte-for-byte port of the server's own
// totpGenerate()/base32Decode(), not a TOTP library, so it can never
// silently drift from what the server verifies against) — this literal
// secret is duplicated in apps/web/e2e/helpers/auth.ts and the two
// MUST stay in sync. Test-only value, not a real credential.
const E2E_OWNER_TOTP_SECRET = 'E2ETESTOWNERSECRETXYZABCDEFGH23';

async function main() {
  // 1. Admin user
  const adminEmail = 'admin@l2asolutions.com';
  const adminPassword = 'L2AAdmin2026!';
  const existingAdmin = await (prisma as any).adminUser.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`Admin user already exists: ${adminEmail}`);
  } else {
    const hash = await bcrypt.hash(adminPassword, 12);
    await (prisma as any).adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: hash,
        firstName: 'L2A',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
      },
    });
    console.log(`Created admin user: ${adminEmail} / ${adminPassword}`);
  }

  // 2. Test tenant
  // Deliberately has NO interswitchClientId: InvoiceService.createInvoice()/
  // submitDraft() pick the submission adapter via
  // `tenantData?.interswitchClientId ? 'interswitch' : appAdapterKey ?? 'mock'`
  // — a tenant with any interswitchClientId set routes to the *real*
  // InterswitchAdapter regardless of appAdapterKey, which would attempt a
  // genuine OAuth call against INTERSWITCH_SANDBOX_URL with fake credentials
  // and fail/hang instead of the near-instant MockAdapter accept/reject this
  // tenant is meant for (dev testing, and the E2E suite in apps/web/e2e/).
  // interswitchBusinessId/interswitchServiceId alone don't affect adapter
  // selection and are harmless to keep — only interswitchClientId does.
  const tenantTin = 'TEST-12345678-0001';
  const TEST_INTERSWITCH_FIELDS = {
    interswitchBusinessId: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
    interswitchServiceId: 'BILLINX001',
  };
  let tenant = await (prisma as any).tenant.findUnique({ where: { tin: tenantTin } });
  if (tenant) {
    console.log(`Test tenant already exists: ${tenant.name} (${tenant.id})`);
  } else {
    tenant = await (prisma as any).tenant.create({
      data: {
        name: 'Test Company Ltd',
        tin: tenantTin,
        appAdapterKey: 'mock',
        environment: 'SANDBOX',
        rateLimitTier: 'STANDARD',
        // lga is required: the New Invoice dashboard form's client-side
        // validateForSubmit() pre-fills seller fields from
        // GET /v1/tenants/me and hard-blocks submission with "LGA is
        // required" if registeredAddress has no lga — apps/web/e2e/'s
        // invoice-round-trip journey needs this tenant submittable.
        registeredAddress: { street: '1 Test Street', city: 'Lagos', state: 'Lagos', lga: 'Ikeja' },
      },
    });
    console.log(`Created test tenant: ${tenant.name} (${tenant.id})`);
  }

  const missingScalarFields = Object.entries(TEST_INTERSWITCH_FIELDS).filter(
    ([key]) => !(tenant as Record<string, unknown>)[key],
  );
  const backfill: Record<string, unknown> = Object.fromEntries(missingScalarFields);

  // Backfill lga onto a tenant seeded before this fix.
  const existingAddress = (tenant.registeredAddress ?? {}) as Record<string, unknown>;
  if (!existingAddress.lga) {
    backfill.registeredAddress = { ...existingAddress, lga: 'Ikeja' };
  }

  // Clears interswitchClientId/secret left over from a dev DB seeded before
  // this fix — re-running this script on an already-seeded database must
  // also correct it, not just skip past the (now-wrong) existing value.
  if (tenant.interswitchClientId || tenant.interswitchClientSecret) {
    backfill.interswitchClientId = null;
    backfill.interswitchClientSecret = null;
    backfill.interswitchSecretIv = null;
  }

  if (Object.keys(backfill).length > 0) {
    tenant = await (prisma as any).tenant.update({
      where: { id: tenant.id },
      data: backfill,
    });
    console.log(
      `  Updated Interswitch test fields: ${Object.keys(backfill).join(', ')}`,
    );
  }

  // 3. Test user in that tenant
  const userEmail = 'owner@testcompany.ng';
  const userPassword = 'TestOwner2026!';
  let user = await (prisma as any).user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: userEmail } },
  });
  if (user) {
    console.log(`Test user already exists: ${userEmail}`);
  } else {
    const hash = await bcrypt.hash(userPassword, 12);
    user = await (prisma as any).user.create({
      data: {
        tenantId: tenant.id,
        email: userEmail,
        passwordHash: hash,
        firstName: 'Test',
        lastName: 'Owner',
        isActive: true,
        isVerified: true,
      },
    });
    await (prisma as any).userRole.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: 'OWNER',
      },
    });
    console.log(`Created test user: ${userEmail} / ${userPassword}`);
    console.log(`  Tenant ID: ${tenant.id}`);
  }

  // Pre-enable MFA with the fixed E2E secret (see comment above) so
  // loginAsOwner() always lands on the real TOTP challenge screen, matching
  // production OWNER-login behaviour, instead of /mfa/setup.
  if (!user.mfaEnabled) {
    const masterKey = await secretsService.getMasterEncryptionKey();
    const { encrypted, iv } = credentialService.encrypt(
      E2E_OWNER_TOTP_SECRET,
      masterKey,
      user.id,
    );
    await (prisma as any).user.update({
      where: { id: user.id },
      data: { mfaSecret: encrypted, mfaSecretIv: iv, mfaEnabled: true },
    });
    console.log('  MFA pre-enabled for owner test user (fixed E2E TOTP secret)');
  }

  // 4. Test VIEWER user in the same tenant — used by apps/web/e2e/'s
  // role-access journey to verify VIEWER restrictions are enforced.
  const viewerEmail = 'testviewer@testcompany.ng';
  const viewerPassword = 'Viewer123!';
  const existingViewer = await (prisma as any).user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: viewerEmail } },
  });
  if (existingViewer) {
    console.log(`Test viewer already exists: ${viewerEmail}`);
  } else {
    const hash = await bcrypt.hash(viewerPassword, 12);
    const viewer = await (prisma as any).user.create({
      data: {
        tenantId: tenant.id,
        email: viewerEmail,
        passwordHash: hash,
        firstName: 'Test',
        lastName: 'Viewer',
        isActive: true,
        isVerified: true,
      },
    });
    await (prisma as any).userRole.create({
      data: {
        userId: viewer.id,
        tenantId: tenant.id,
        role: 'VIEWER',
      },
    });
    console.log(`Created test viewer: ${viewerEmail} / ${viewerPassword}`);
  }

  console.log('\nDone. Login at http://localhost:3001/login');
  console.log(`  Owner:  ${userEmail} / ${userPassword}`);
  console.log(`  Viewer: ${viewerEmail} / ${viewerPassword}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
