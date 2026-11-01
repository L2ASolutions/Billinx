/**
 * Seeds realistic demo invoices for a tenant so the dashboard has content
 * to show for a demo. Run with: npx tsx scripts/seed-demo-invoices.ts
 *
 * Targets the tenant identified by DEMO_TENANT_TIN (defaults to the dev
 * seed tenant created by scripts/seed-dev-users.ts). Safe to re-run —
 * invoices are tagged with sourceReference values ("DEMO-SEED-01" etc.)
 * and the script skips any that already exist.
 *
 * Uses the real StateMachineService (src/modules/invoice/services/
 * state-machine.service.ts) to validate every status transition, and
 * writes an InvoiceStateHistory row for each one — invoice.status is
 * never set without going through assertValidTransition() first, mirroring
 * how InvoiceService/SubmissionService do it.
 *
 * NOTE ON STATE MACHINE COVERAGE: this script deliberately walks the FULL
 * declared transition chain (DRAFT -> VALIDATING -> QUEUED -> SUBMITTING ->
 * SUBMITTED -> ACCEPTED/REJECTED). The real submission.service.ts actually
 * skips VALIDATING and SUBMITTED entirely (DRAFT -> QUEUED -> SUBMITTING ->
 * ACCEPTED/REJECTED, confirmed by reading queueInvoice()/handleSuccess()) —
 * VALIDATING/SUBMITTED/VALIDATION_FAILED appear to be declared-but-dead
 * states in current production code. This script uses the state machine's
 * own declared transitions (all valid per stateMachine.assertValidTransition)
 * rather than replicating that shortcut, since the goal here is demo data
 * that is unambiguously correct against the state machine's own rules.
 */
import { PrismaClient, InvoiceStatus } from '@prisma/client';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { StateMachineService } from '../src/modules/invoice/services/state-machine.service';

const prisma = new PrismaClient();
const stateMachine = new StateMachineService();

const DEMO_TENANT_TIN = process.env.DEMO_TENANT_TIN ?? 'TEST-12345678-0001';
const VAT_RATE = 7.5;

// ── Line item templates ─────────────────────────────────────────────────────

const PRODUCTS = {
  cement: {
    itemType: 'PRODUCT',
    name: 'Portland Cement (42.5N)',
    description: 'Bulk Portland cement bags for construction',
    hsnCode: '2523',
    productCategory: 'Cement and clinker',
    priceUnit: 'EA',
    unitPrice: 4500,
  },
  rice: {
    itemType: 'PRODUCT',
    name: 'Premium Parboiled Rice (50kg)',
    description: 'Bulk parboiled rice bags',
    hsnCode: '1006',
    productCategory: 'Cereals and grain milling products',
    priceUnit: 'EA',
    unitPrice: 45000,
  },
  stationery: {
    itemType: 'PRODUCT',
    name: 'A4 Office Paper (Ream)',
    description: 'Office stationery supply — A4 copier paper',
    hsnCode: '4820',
    productCategory: 'Paper and paperboard products',
    priceUnit: 'EA',
    unitPrice: 3500,
  },
  diesel: {
    itemType: 'PRODUCT',
    name: 'Automotive Gas Oil (Diesel)',
    description: 'Bulk diesel fuel supply',
    hsnCode: '2710',
    productCategory: 'Petroleum oils and fuels',
    priceUnit: 'LTR',
    unitPrice: 1150,
  },
  phones: {
    itemType: 'PRODUCT',
    name: 'Mobile Phone Accessories (Bulk)',
    description: 'Bulk supply of mobile phone accessories',
    hsnCode: '8517',
    productCategory: 'Telephone sets and parts',
    priceUnit: 'EA',
    unitPrice: 8500,
  },
} as const;

const SERVICES = {
  software: {
    itemType: 'SERVICE',
    name: 'Software Development Retainer',
    description: 'Monthly software development and maintenance retainer',
    isicCode: '6201',
    serviceCategory: 'Computer programming activities',
    priceUnit: 'EA',
    unitPrice: 650000,
  },
  logistics: {
    itemType: 'SERVICE',
    name: 'Haulage & Logistics Services',
    description: 'Freight haulage services — Lagos to regional depots',
    isicCode: '4923',
    serviceCategory: 'Freight transport by road',
    priceUnit: 'EA',
    unitPrice: 25000,
  },
  cleaning: {
    itemType: 'SERVICE',
    name: 'Facility Management Services',
    description: 'Monthly facility cleaning and management services',
    isicCode: '8121',
    serviceCategory: 'Cleaning services',
    priceUnit: 'EA',
    unitPrice: 180000,
  },
  catering: {
    itemType: 'SERVICE',
    name: 'Corporate Event Catering',
    description: 'Catering services for a corporate event',
    isicCode: '5610',
    serviceCategory: 'Event catering services',
    priceUnit: 'EA',
    unitPrice: 8500,
  },
  training: {
    itemType: 'SERVICE',
    name: 'Corporate Training Programme',
    description: 'Staff capacity-building and training session',
    isicCode: '8299',
    serviceCategory: 'Business support service activities',
    priceUnit: 'EA',
    unitPrice: 250000,
  },
  itconsulting: {
    itemType: 'SERVICE',
    name: 'IT Consulting & Systems Support',
    description: 'Monthly IT consulting and systems support retainer',
    isicCode: '6202',
    serviceCategory: 'Computer consultancy activities',
    priceUnit: 'EA',
    unitPrice: 450000,
  },
} as const;

type ItemKey = keyof typeof PRODUCTS | keyof typeof SERVICES;

function templateFor(key: ItemKey): any {
  return (PRODUCTS as any)[key] ?? (SERVICES as any)[key];
}

const NG_LOCATIONS = [
  { city: 'Lagos', state: 'NG-LA' },
  { city: 'Abuja', state: 'NG-FC' },
  { city: 'Port Harcourt', state: 'NG-RI' },
  { city: 'Kano', state: 'NG-KN' },
  { city: 'Ibadan', state: 'NG-OY' },
];

// ── Demo invoice specs ───────────────────────────────────────────────────────
// daysAgo spans ~1-60 days so createdAt/issueDate spread across the last
// 30-60 days (Revenue Trend groups by issueDate — see invoice.service.ts
// getDashboardCharts()).

interface InvoiceSpec {
  ref: string;
  buyerName: string;
  kind: 'B2B' | 'B2C';
  typeCode: 'STANDARD' | 'CREDIT_NOTE' | 'PROFORMA';
  targetStatus: InvoiceStatus;
  daysAgo: number;
  items: { key: ItemKey; qty: number }[];
  originalIrnRef?: string; // ref of an earlier spec, for CREDIT_NOTE
  note?: string;
}

const SPECS: InvoiceSpec[] = [
  { ref: 'DEMO-SEED-01', buyerName: 'Zenith Merchants Trading Co Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 3, items: [{ key: 'cement', qty: 220 }] },
  { ref: 'DEMO-SEED-02', buyerName: 'Chidinma Okafor', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 5, items: [{ key: 'phones', qty: 12 }] },
  { ref: 'DEMO-SEED-03', buyerName: 'Dangote Cement Distributors Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 8, items: [{ key: 'cement', qty: 480 }] },
  { ref: 'DEMO-SEED-04', buyerName: 'Ibrahim Suleiman', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 11, items: [{ key: 'rice', qty: 6 }] },
  { ref: 'DEMO-SEED-05', buyerName: 'Konga Retail Solutions Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 14, items: [{ key: 'stationery', qty: 150 }, { key: 'phones', qty: 40 }] },
  { ref: 'DEMO-SEED-06', buyerName: 'Sahara Foods Processing Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 17, items: [{ key: 'rice', qty: 60 }] },
  { ref: 'DEMO-SEED-07', buyerName: 'Adaeze Nwosu', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 20, items: [{ key: 'catering', qty: 80 }] },
  { ref: 'DEMO-SEED-08', buyerName: 'Chisco Logistics & Transport Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 24, items: [{ key: 'logistics', qty: 35 }, { key: 'diesel', qty: 1800 }] },
  { ref: 'DEMO-SEED-09', buyerName: 'Lagos Continental Hotels Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 27, items: [{ key: 'cleaning', qty: 1 }] },
  { ref: 'DEMO-SEED-10', buyerName: 'Tunde Bakare', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'ACCEPTED', daysAgo: 31, items: [{ key: 'training', qty: 1 }] },
  { ref: 'DEMO-SEED-11', buyerName: 'Interswitch Payment Systems Ltd', kind: 'B2B', typeCode: 'CREDIT_NOTE', targetStatus: 'ACCEPTED', daysAgo: 34, items: [{ key: 'itconsulting', qty: 1 }], originalIrnRef: 'DEMO-SEED-03', note: 'Credit note for over-billed quantity on original invoice' },
  { ref: 'DEMO-SEED-12', buyerName: 'GreenFuel Energy Resources Ltd', kind: 'B2B', typeCode: 'CREDIT_NOTE', targetStatus: 'ACCEPTED', daysAgo: 36, items: [{ key: 'diesel', qty: 250 }], originalIrnRef: 'DEMO-SEED-06', note: 'Credit note for returned goods on original invoice' },
  { ref: 'DEMO-SEED-13', buyerName: 'Ngozi Eze', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'REJECTED', daysAgo: 38, items: [{ key: 'phones', qty: 5 }] },
  { ref: 'DEMO-SEED-14', buyerName: 'Flour Mills Distribution Partners Ltd', kind: 'B2B', typeCode: 'STANDARD', targetStatus: 'REJECTED', daysAgo: 42, items: [{ key: 'rice', qty: 90 }] },
  { ref: 'DEMO-SEED-15', buyerName: 'Emeka Obi', kind: 'B2C', typeCode: 'STANDARD', targetStatus: 'REJECTED', daysAgo: 46, items: [{ key: 'stationery', qty: 20 }] },
  { ref: 'DEMO-SEED-16', buyerName: 'MTN Business Solutions Nigeria Ltd', kind: 'B2B', typeCode: 'PROFORMA', targetStatus: 'DRAFT', daysAgo: 50, items: [{ key: 'software', qty: 1 }] },
  { ref: 'DEMO-SEED-17', buyerName: 'Fatima Bello', kind: 'B2C', typeCode: 'PROFORMA', targetStatus: 'DRAFT', daysAgo: 54, items: [{ key: 'catering', qty: 40 }] },
  { ref: 'DEMO-SEED-18', buyerName: 'Access Corporate Facilities Management Ltd', kind: 'B2B', typeCode: 'PROFORMA', targetStatus: 'VALIDATION_FAILED', daysAgo: 57, items: [{ key: 'cleaning', qty: 2 }] },
  { ref: 'DEMO-SEED-19', buyerName: 'Oluwaseun Adeyemi', kind: 'B2C', typeCode: 'CREDIT_NOTE', targetStatus: 'VALIDATION_FAILED', daysAgo: 60, items: [{ key: 'phones', qty: 3 }], originalIrnRef: 'DEMO-SEED-09' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '');
}

function randomTin(): string {
  const digits = crypto.randomInt(10000000, 99999999);
  return `${digits}-0001`;
}

function randomPhone(): string {
  const n = crypto.randomInt(700000000, 799999999);
  return `+234${n}`;
}

function buildParty(name: string, kind: 'B2B' | 'B2C', idx: number) {
  const loc = NG_LOCATIONS[idx % NG_LOCATIONS.length];
  const isB2B = kind === 'B2B';
  return {
    partyName: name,
    tin: isB2B ? randomTin() : null,
    email: isB2B ? `accounts@${slug(name)}.ng` : `${slug(name)}@gmail.com`,
    telephone: randomPhone(),
    postalAddress: {
      streetName: `${10 + idx} ${loc.city} Business Avenue`,
      cityName: loc.city,
      state: loc.state,
      country: 'NG',
    } as { streetName: string; cityName: string; state: string; lga?: string; country: string },
  };
}

function buildLineItem(key: ItemKey, qty: number) {
  const tpl = templateFor(key);
  const lineExtensionAmount = qty * tpl.unitPrice;
  const base: any = {
    itemType: tpl.itemType,
    invoicedQuantity: qty,
    lineExtensionAmount,
    item: { name: tpl.name, description: tpl.description },
    price: {
      priceAmount: tpl.unitPrice,
      baseQuantity: 1,
      priceUnit: tpl.priceUnit,
    },
    taxCategory: { id: 'STANDARD_VAT', percent: VAT_RATE },
  };
  if (tpl.itemType === 'PRODUCT') {
    base.hsnCode = tpl.hsnCode;
    base.productCategory = tpl.productCategory;
  } else {
    base.isicCode = tpl.isicCode;
    base.serviceCategory = tpl.serviceCategory;
  }
  return base;
}

function generateFirsIrn(platformIrn: string): string {
  // Mirrors MockAdapter.generateFirsIrn() exactly (mock/mock.adapter.ts).
  const parts = platformIrn.split('-');
  const datePart = parts[2] ?? '20260101';
  const serviceId = parts[1] ?? 'SVC00001';
  const acm = serviceId.substring(0, 3).toUpperCase();
  const uid = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `NGA-MBS-${datePart.substring(0, 4)}-${datePart.substring(4, 6)}-${datePart.substring(6, 8)}-${acm}-${uid}`;
}

async function generateMockQrCode(firsIrn: string): Promise<string> {
  const text = `BILLINX_QR|${firsIrn}|${new Date().toISOString()}`;
  const buffer = await QRCode.toBuffer(text);
  return buffer.toString('base64');
}

const REJECTION_REASON =
  'Invalid or unregistered Buyer TIN. The TIN provided does not match any registered taxpayer in the FIRS database.';

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { tin: DEMO_TENANT_TIN },
  });
  if (!tenant) {
    console.error(
      `No tenant found with TIN ${DEMO_TENANT_TIN}. Run scripts/seed-dev-users.ts first, or set DEMO_TENANT_TIN to an existing tenant's TIN.`,
    );
    process.exit(1);
  }

  const owner = await prisma.user.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    console.error(`Tenant ${tenant.name} (${tenant.id}) has no users — aborting.`);
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('Seeding demo invoices for the CURRENT active dev tenant:');
  console.log(`  Tenant:  ${tenant.name}  (id: ${tenant.id})`);
  console.log(`  TIN:     ${tenant.tin}`);
  console.log(`  Actor:   ${owner.email}  (id: ${owner.id})`);
  console.log('='.repeat(70));

  const svcId = (tenant.interswitchServiceId ?? 'SVC00001')
    .substring(0, 8)
    .padEnd(8, '0');

  // Compute the next available INV<year> sequence per year across all
  // existing invoices (platformIrn is globally unique — see the
  // ecs/cloudwatch-adjacent IRN-collision note in CLAUDE.md's Open Issues).
  const existingIrns = await prisma.invoice.findMany({
    select: { platformIrn: true },
    where: { platformIrn: { startsWith: 'INV' } },
  });
  const seqByYear = new Map<string, number>();
  for (const { platformIrn } of existingIrns) {
    const m = platformIrn.match(/^INV(\d{4})(\d{4})-/);
    if (!m) continue;
    const [, year, seq] = m;
    seqByYear.set(year, Math.max(seqByYear.get(year) ?? 0, parseInt(seq, 10)));
  }

  const platformIrnByRef = new Map<string, string>();
  let created = 0;
  let skipped = 0;

  for (let idx = 0; idx < SPECS.length; idx++) {
    const spec = SPECS[idx];

    const alreadyExists = await prisma.invoice.findFirst({
      where: { tenantId: tenant.id, sourceReference: spec.ref },
      select: { id: true, platformIrn: true },
    });
    if (alreadyExists) {
      console.log(`  [skip] ${spec.ref} already exists (${alreadyExists.platformIrn})`);
      platformIrnByRef.set(spec.ref, alreadyExists.platformIrn);
      skipped++;
      continue;
    }

    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - spec.daysAgo);
    createdAt.setHours(9 + (idx % 6), 15 + ((idx * 7) % 40), 0, 0);

    const datePart = `${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`;
    const year = datePart.substring(0, 4);
    const seq = (seqByYear.get(year) ?? 0) + 1;
    seqByYear.set(year, seq);
    const platformIrn = `INV${year}${String(seq).padStart(4, '0')}-${svcId}-${datePart}`;
    platformIrnByRef.set(spec.ref, platformIrn);

    const seller = buildParty(tenant.name, 'B2B', idx);
    seller.tin = tenant.tin;
    seller.postalAddress = {
      streetName: (tenant.registeredAddress as any)?.street ?? '1 Test Street',
      cityName: (tenant.registeredAddress as any)?.city ?? 'Lagos',
      state: 'NG-LA',
      lga: (tenant.registeredAddress as any)?.lga ?? 'Ikeja',
      country: 'NG',
    };
    const buyer = buildParty(spec.buyerName, spec.kind, idx);

    const lineItems = spec.items.map((li) => buildLineItem(li.key, li.qty));
    const lineExtensionAmount = lineItems.reduce(
      (sum, li) => sum + li.lineExtensionAmount,
      0,
    );
    const taxAmount = Math.round(lineExtensionAmount * (VAT_RATE / 100) * 100) / 100;
    const payableAmount = lineExtensionAmount + taxAmount;

    const legalMonetaryTotal = {
      lineExtensionAmount,
      taxExclusiveAmount: lineExtensionAmount,
      taxInclusiveAmount: payableAmount,
      payableAmount,
    };
    const taxTotal = [
      {
        taxAmount,
        taxSubtotal: [
          {
            taxableAmount: lineExtensionAmount,
            taxAmount,
            taxCategory: { id: 'STANDARD_VAT', percent: VAT_RATE },
          },
        ],
      },
    ];

    const dueDate = new Date(createdAt);
    dueDate.setDate(dueDate.getDate() + 30);

    const originalIrn = spec.originalIrnRef
      ? platformIrnByRef.get(spec.originalIrnRef)
      : null;

    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        userId: owner.id,
        environment: tenant.environment,
        invoiceTypeCode: spec.typeCode,
        invoiceKind: spec.kind,
        platformIrn,
        sourceReference: spec.ref,
        sellerTin: seller.tin!,
        sellerName: seller.partyName,
        buyerTin: buyer.tin,
        buyerName: buyer.partyName,
        buyerEmail: buyer.email,
        issueDate: createdAt,
        dueDate,
        paymentDueDate: dueDate,
        taxPointDate: createdAt,
        currency: 'NGN',
        subtotal: lineExtensionAmount,
        vatAmount: taxAmount,
        totalAmount: payableAmount,
        lineItems: JSON.parse(JSON.stringify(lineItems)),
        taxTotal: JSON.parse(JSON.stringify(taxTotal)),
        legalMonetaryTotal: JSON.parse(JSON.stringify(legalMonetaryTotal)),
        note: spec.note ?? null,
        originalIrn: originalIrn ?? null,
        metadata: JSON.parse(
          JSON.stringify({ sellerParty: seller, buyerParty: buyer }),
        ),
        status: 'DRAFT',
        createdAt,
        updatedAt: createdAt,
      },
    });

    await prisma.invoiceStateHistory.create({
      data: {
        invoiceId: invoice.id,
        tenantId: tenant.id,
        toStatus: 'DRAFT',
        actor: `user:${owner.id}`,
        reason: 'Invoice created',
        createdAt,
      },
    });

    // ── Walk the state machine to the target status ─────────────────────────
    const stepDate = (mins: number) => new Date(createdAt.getTime() + mins * 60000);

    const transition = async (
      from: InvoiceStatus,
      to: InvoiceStatus,
      actor: string,
      reason: string,
      at: Date,
      extra: Record<string, unknown> = {},
    ) => {
      stateMachine.assertValidTransition(from, to);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: to, ...extra },
      });
      await prisma.invoiceStateHistory.create({
        data: {
          invoiceId: invoice.id,
          tenantId: tenant.id,
          fromStatus: from,
          toStatus: to,
          actor,
          reason,
          createdAt: at,
        },
      });
    };

    if (spec.targetStatus === 'DRAFT') {
      // No further transitions.
    } else {
      await transition(
        'DRAFT',
        'VALIDATING',
        `user:${owner.id}`,
        'Submitted for validation',
        stepDate(2),
      );

      if (spec.targetStatus === 'VALIDATION_FAILED') {
        await transition(
          'VALIDATING',
          'VALIDATION_FAILED',
          'system:invoice-validation',
          'FIRS schema validation failed: missing product/service classification (hsnCode/isicCode) on one or more line items',
          stepDate(3),
        );
      } else {
        await transition(
          'VALIDATING',
          'QUEUED',
          'system:submission-service',
          'Invoice queued for FIRS submission',
          stepDate(4),
        );
        await transition(
          'QUEUED',
          'SUBMITTING',
          'system:submission-worker',
          'Submitting to FIRS',
          stepDate(6),
        );
        await transition(
          'SUBMITTING',
          'SUBMITTED',
          'system:submission-worker',
          'Awaiting FIRS confirmation',
          stepDate(8),
        );

        if (spec.targetStatus === 'ACCEPTED') {
          const firsConfirmedIrn = generateFirsIrn(platformIrn);
          const qrCodeBase64 = await generateMockQrCode(firsConfirmedIrn);
          const acceptedAt = stepDate(12);
          await transition(
            'SUBMITTED',
            'ACCEPTED',
            'system:firs',
            `FIRS accepted. IRN: ${platformIrn}. FIRS Reference: ${firsConfirmedIrn}`,
            acceptedAt,
            { firsConfirmedIrn, qrCodeBase64, acceptedAt, submittedAt: stepDate(8) },
          );
        } else if (spec.targetStatus === 'REJECTED') {
          const rejectedAt = stepDate(12);
          await transition(
            'SUBMITTED',
            'REJECTED',
            'system:firs',
            REJECTION_REASON,
            rejectedAt,
            { rejectedAt, submittedAt: stepDate(8) },
          );
        }
      }
    }

    console.log(
      `  [created] ${spec.ref}  ${platformIrn}  ${spec.typeCode}/${spec.kind}  -> ${spec.targetStatus}  (${spec.buyerName}, ₦${payableAmount.toLocaleString()}, ${createdAt.toISOString().slice(0, 10)})`,
    );
    created++;
  }

  console.log('='.repeat(70));
  console.log(`Done. Created ${created} invoice(s), skipped ${skipped} already-existing.`);

  const total = await prisma.invoice.count({ where: { tenantId: tenant.id } });
  const accepted = await prisma.invoice.count({
    where: { tenantId: tenant.id, status: 'ACCEPTED' },
  });
  const rejected = await prisma.invoice.count({
    where: { tenantId: tenant.id, status: 'REJECTED' },
  });
  console.log(
    `Tenant now has ${total} invoice(s) total (${accepted} ACCEPTED, ${rejected} REJECTED).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
