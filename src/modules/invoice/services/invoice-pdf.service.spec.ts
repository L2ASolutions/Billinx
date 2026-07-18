/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';

// A well-known valid 1x1 transparent PNG, base64-encoded — used to exercise
// the real react-pdf Image embedding path (not just a truthy string), since
// an invalid PNG would fail inside renderToBuffer.
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const TENANT_ID = 'tenant-001';

const SELLER = {
  tin: 'TIN-000001',
  partyName: 'Dangote Group',
  email: 'invoices@dangote.com',
  telephone: '+2348012345678',
  postalAddress: {
    streetName: '32 Owonikoko Street',
    cityName: 'Gwarikpa',
    countryCode: 'NG',
  },
};

const BUYER = {
  tin: 'NG-TECH-001',
  partyName: 'TechCorp Nigeria',
  email: 'accounts@techcorp.ng',
  postalAddress: {
    streetName: '15 Adeola Odeku',
    cityName: 'Victoria Island',
    countryCode: 'NG',
  },
};

const LINE_ITEM = {
  hsnCode: 'CC-001',
  invoicedQuantity: 10,
  lineExtensionAmount: 100000.0,
  discountAmount: 0,
  item: { name: 'Premium Cement Bags', description: '50kg bags' },
  price: { priceAmount: 10000.0, priceUnit: 'EA' },
};

const TAX_TOTAL = [
  {
    taxAmount: 7500.0,
    taxSubtotal: [
      {
        taxableAmount: 100000.0,
        taxAmount: 7500.0,
        taxCategory: { id: 'STANDARD_VAT', percent: 7.5 },
      },
    ],
  },
];

const LEGAL_MONETARY_TOTAL = {
  lineExtensionAmount: 100000.0,
  taxExclusiveAmount: 100000.0,
  taxInclusiveAmount: 107500.0,
  payableAmount: 107500.0,
};

function makeInvoice(overrides: Record<string, any> = {}): any {
  return {
    id: 'inv-1',
    tenantId: TENANT_ID,
    platformIrn: 'INV001-94ND90NR-20240611',
    firsConfirmedIrn: 'NGA-MBS-2024-06-11-SVC-ABCDEF01',
    invoiceKind: 'B2B',
    issueDate: new Date('2024-06-11'),
    dueDate: new Date('2024-07-11'),
    submittedAt: new Date('2024-06-11T10:15:00.000Z'),
    currency: 'NGN',
    sellerName: 'Dangote Group',
    sellerTin: 'TIN-000001',
    buyerName: 'TechCorp Nigeria',
    buyerTin: 'NG-TECH-001',
    buyerEmail: null,
    subtotal: 100000.0,
    vatAmount: 7500.0,
    totalAmount: 107500.0,
    metadata: { sellerParty: SELLER, buyerParty: BUYER },
    lineItems: [LINE_ITEM],
    taxTotal: TAX_TOTAL,
    legalMonetaryTotal: LEGAL_MONETARY_TOTAL,
    qrCodeBase64: VALID_PNG_BASE64,
    ...overrides,
  };
}

function makeTenant(overrides: Record<string, any> = {}) {
  return {
    registeredAddress: {
      streetName: 'Fallback Street',
      cityName: 'Lagos',
      countryCode: 'NG',
    },
    telephone: '+2348000000000',
    phone: null,
    ...overrides,
  };
}

describe('InvoicePdfService', () => {
  let invoiceRepository: { findById: jest.Mock };
  let prisma: { asAdmin: jest.Mock };
  let service: InvoicePdfService;

  beforeEach(() => {
    invoiceRepository = { findById: jest.fn() };
    prisma = {
      asAdmin: jest.fn((fn: any) =>
        fn({ tenant: { findUnique: jest.fn().mockResolvedValue(makeTenant()) } }),
      ),
    };
    service = new InvoicePdfService(
      invoiceRepository as any,
      prisma as any,
    );
  });

  it('throws NotFoundException when the invoice does not exist', async () => {
    invoiceRepository.findById.mockResolvedValue(null);
    await expect(service.generatePdf('missing', TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the invoice belongs to another tenant', async () => {
    invoiceRepository.findById.mockResolvedValue(
      makeInvoice({ tenantId: 'other-tenant' }),
    );
    await expect(service.generatePdf('inv-1', TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('generates a valid PDF buffer with a filename derived from the FIRS-confirmed IRN', async () => {
    invoiceRepository.findById.mockResolvedValue(makeInvoice());

    const result = await service.generatePdf('inv-1', TENANT_ID);

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.filename).toBe(
      'invoice-NGA-MBS-2024-06-11-SVC-ABCDEF01.pdf',
    );
  });

  it('falls back to the platformIrn for the filename when firsConfirmedIrn is not yet set', async () => {
    invoiceRepository.findById.mockResolvedValue(
      makeInvoice({ firsConfirmedIrn: null }),
    );

    const result = await service.generatePdf('inv-1', TENANT_ID);

    expect(result.filename).toBe('invoice-INV001-94ND90NR-20240611.pdf');
  });

  it('does not crash and renders a valid PDF when qrCodeBase64 is null', async () => {
    invoiceRepository.findById.mockResolvedValue(
      makeInvoice({ qrCodeBase64: null }),
    );

    const result = await service.generatePdf('inv-1', TENANT_ID);

    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('falls back to the tenant registered address when seller party metadata is missing', async () => {
    invoiceRepository.findById.mockResolvedValue(
      makeInvoice({ metadata: {} }),
    );

    const result = await service.generatePdf('inv-1', TENANT_ID);

    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(prisma.asAdmin).toHaveBeenCalled();
  });

  it('renders without throwing when line items and tax totals are empty', async () => {
    invoiceRepository.findById.mockResolvedValue(
      makeInvoice({ lineItems: [], taxTotal: [] }),
    );

    const result = await service.generatePdf('inv-1', TENANT_ID);

    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
