/**
 * Dev seed: creates an admin user and a test tenant with an OWNER user.
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
  // interswitchBusinessId is the sample business_id from the Interswitch
  // NRS docs — safe placeholder for testing only, not a real registration.
  const tenantTin = 'TEST-12345678-0001';
  const TEST_INTERSWITCH_FIELDS = {
    interswitchBusinessId: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
    interswitchClientId: 'TEST001',
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
        registeredAddress: { street: '1 Test Street', city: 'Lagos', state: 'Lagos' },
      },
    });
    console.log(`Created test tenant: ${tenant.name} (${tenant.id})`);
  }

  const missingScalarFields = Object.entries(TEST_INTERSWITCH_FIELDS).filter(
    ([key]) => !tenant[key],
  );
  const backfill: Record<string, unknown> = Object.fromEntries(missingScalarFields);

  // interswitchClientSecret is a placeholder string, but genuinely encrypted
  // with the app's own CredentialService/master key — so it decrypts
  // correctly if anything ever calls submit() for real, not just dummy bytes.
  if (!tenant.interswitchClientSecret || !tenant.interswitchSecretIv) {
    const masterKey = await secretsService.getMasterEncryptionKey();
    const { encrypted, iv } = credentialService.encrypt(
      'test-placeholder-client-secret-not-real',
      masterKey,
      tenant.id,
    );
    backfill.interswitchClientSecret = encrypted;
    backfill.interswitchSecretIv = iv;
  }

  if (Object.keys(backfill).length > 0) {
    tenant = await (prisma as any).tenant.update({
      where: { id: tenant.id },
      data: backfill,
    });
    console.log(
      `  Backfilled missing Interswitch test fields: ${Object.keys(backfill).join(', ')}`,
    );
  }

  // 3. Test user in that tenant
  const userEmail = 'owner@testcompany.ng';
  const userPassword = 'TestOwner2026!';
  const existingUser = await (prisma as any).user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: userEmail } },
  });
  if (existingUser) {
    console.log(`Test user already exists: ${userEmail}`);
  } else {
    const hash = await bcrypt.hash(userPassword, 12);
    const user = await (prisma as any).user.create({
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

  console.log('\nDone. Login at http://localhost:3001/login');
  console.log(`  Email: ${userEmail}`);
  console.log(`  Password: ${userPassword}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
