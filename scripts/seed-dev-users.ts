/**
 * Dev seed: creates an admin user and a test tenant with an OWNER user.
 * Run with: npx ts-node scripts/seed-dev-users.ts
 * (or: npx tsx scripts/seed-dev-users.ts)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
  const tenantTin = 'TEST-12345678-0001';
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
