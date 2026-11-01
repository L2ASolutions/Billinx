/// <reference types="jest" />

/**
 * Line-item shape normalisation.
 *
 * The New Invoice dashboard form sends a flat line-item shape
 * ({ quantity, unitPrice, priceUnit, hsnCode, ... }) but InterswitchAdapter
 * and InvoiceValidationService read the canonical nested shape
 * ({ invoicedQuantity, price: { priceAmount, ... }, hsnCode, ... }).
 * InvoiceService.normaliseLineItems() converts flat → canonical and is a
 * no-op for already-canonical input (the API/bulk-import paths).
 */

import { BadRequestException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

function makeFlatLineItem(overrides: Record<string, any> = {}) {
  return {
    description: 'Widget',
    quantity: 2,
    unitPrice: 500,
    priceUnit: 'EA',
    taxCode: 'STANDARD_VAT',
    vatRate: 7.5,
    itemType: 'PRODUCT',
    hsnCode: 'HSN001',
    totalPrice: 1075,
    vatAmount: 75,
    ...overrides,
  };
}

function makeCanonicalLineItem(overrides: Record<string, any> = {}) {
  return {
    invoicedQuantity: 3,
    price: { priceAmount: 200, baseQuantity: 1, priceUnit: 'EA' },
    description: 'Gadget',
    hsnCode: 'HSN002',
    productCategory: 'Electronics',
    itemType: 'PRODUCT',
    ...overrides,
  };
}

function makeInvoiceRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    status: 'DRAFT',
    sellerTin: '123',
    sellerName: 'Seller',
    buyerName: 'Buyer',
    buyerTin: null,
    issueDate: new Date('2026-07-20'),
    dueDate: null,
    currency: 'NGN',
    subtotal: 1000,
    vatAmount: 75,
    totalAmount: 1075,
    lineItems: [],
    taxTotal: [],
    legalMonetaryTotal: {},
    platformIrn: 'IRN-001',
    invoiceTypeCode: 'STANDARD',
    metadata: {},
    createdAt: new Date('2026-07-20'),
    updatedAt: new Date('2026-07-20'),
    ...overrides,
  };
}

function buildService(
  overrides: Partial<{
    repo: any;
    irn: any;
    stateMachine: any;
    activity: any;
    prisma: any;
    submission: any;
    events: any;
    xmlBuilder: any;
    email: any;
    validation: any;
  }> = {},
): any {
  return new InvoiceService(
    overrides.repo ?? {},
    overrides.irn ?? {
      generateUniqueIrn: jest.fn().mockResolvedValue('IRN-001'),
    },
    overrides.stateMachine ?? {},
    overrides.activity ?? { track: jest.fn() },
    overrides.prisma ?? { asAdmin: jest.fn() },
    overrides.submission ?? {
      queueInvoice: jest.fn().mockResolvedValue(undefined),
    },
    overrides.events ?? { emit: jest.fn() },
    overrides.xmlBuilder ?? {},
    overrides.email ?? { sendInvoiceToBuyer: jest.fn() },
    overrides.validation ?? { validateInvoiceFields: jest.fn() },
  );
}

describe('InvoiceService.normaliseLineItems', () => {
  const svc = buildService();

  function normalise(items: any) {
    return svc.normaliseLineItems(items);
  }

  it('transforms flat form line items into canonical top-level shape', () => {
    const [result] = normalise([makeFlatLineItem()]);
    expect(result.invoicedQuantity).toBe(2);
    expect(result.price).toEqual({
      priceAmount: 500,
      baseQuantity: 1,
      priceUnit: 'EA',
    });
    expect(result.description).toBe('Widget');
    expect(result.hsnCode).toBe('HSN001');
    expect(result.itemType).toBe('PRODUCT');
    expect(result.isicCode).toBeUndefined();
    expect(result.serviceCategory).toBeUndefined();
    expect(result.quantity).toBeUndefined();
    expect(result.unitPrice).toBeUndefined();
    expect(result.priceUnit).toBeUndefined();
  });

  it('passes already-canonical items through unchanged (no double-transform)', () => {
    const canonical = makeCanonicalLineItem();
    const [result] = normalise([canonical]);
    expect(result).toBe(canonical);
  });

  it('maps SERVICE items to top-level isicCode/serviceCategory, not hsnCode/productCategory', () => {
    const flatService = makeFlatLineItem({
      itemType: 'SERVICE',
      hsnCode: undefined,
      isicCode: 'ISIC001',
      serviceCategory: 'Consulting',
    });
    const [result] = normalise([flatService]);
    expect(result.itemType).toBe('SERVICE');
    expect(result.isicCode).toBe('ISIC001');
    expect(result.serviceCategory).toBe('Consulting');
    expect(result.hsnCode).toBeUndefined();
    expect(result.productCategory).toBeUndefined();
  });

  it('maps PRODUCT items (including default itemType) to top-level hsnCode/productCategory', () => {
    const flatProduct = makeFlatLineItem({
      itemType: undefined,
      productCategory: 'Hardware',
    });
    const [result] = normalise([flatProduct]);
    expect(result.itemType).toBe('PRODUCT');
    expect(result.hsnCode).toBe('HSN001');
    expect(result.productCategory).toBe('Hardware');
    expect(result.isicCode).toBeUndefined();
    expect(result.serviceCategory).toBeUndefined();
  });

  it('defaults baseQuantity to 1 and priceUnit to EA when absent', () => {
    const [result] = normalise([makeFlatLineItem({ priceUnit: undefined })]);
    expect(result.price.baseQuantity).toBe(1);
    expect(result.price.priceUnit).toBe('EA');
  });

  it('upper-cases the form\'s lowercase itemType values ("product"/"service")', () => {
    const [result] = normalise([makeFlatLineItem({ itemType: 'product' })]);
    expect(result.itemType).toBe('PRODUCT');
  });

  it('leaves missing productCategory/serviceCategory missing rather than inventing a default', () => {
    const [result] = normalise([makeFlatLineItem()]);
    expect(result.productCategory).toBeUndefined();
  });

  it('preserves extra fields not part of the canonical shape', () => {
    const [result] = normalise([
      makeFlatLineItem({ discountRate: 10, discountAmount: 50 }),
    ]);
    expect(result.taxCode).toBe('STANDARD_VAT');
    expect(result.vatRate).toBe(7.5);
    expect(result.discountRate).toBe(10);
    expect(result.discountAmount).toBe(50);
  });

  it('handles a mixed batch of flat and canonical items independently', () => {
    const [flatResult, canonicalResult] = normalise([
      makeFlatLineItem(),
      makeCanonicalLineItem(),
    ]);
    expect(flatResult.invoicedQuantity).toBe(2);
    expect(canonicalResult.invoicedQuantity).toBe(3);
    expect(canonicalResult).toBe(canonicalResult);
  });

  it('returns non-array input unchanged', () => {
    expect(svc.normaliseLineItems(undefined)).toBeUndefined();
    expect(svc.normaliseLineItems(null)).toBeNull();
  });
});

describe('InvoiceService — normalisation is applied at every DB-write call site', () => {
  describe('createInvoice()', () => {
    it('normalises flat line items before both validation and storage', async () => {
      const createMock = jest.fn().mockResolvedValue(makeInvoiceRecord());
      const repo = {
        findBySourceReference: jest.fn().mockResolvedValue(null),
        create: createMock,
        addStateHistory: jest.fn().mockResolvedValue({}),
      };
      const validateInvoiceFields = jest.fn();
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            tenant: {
              findUnique: jest.fn().mockResolvedValue({
                tin: '123',
                appAdapterKey: 'mock',
                interswitchServiceId: 'SVC1',
                interswitchClientId: null,
              }),
            },
          }),
        ),
      };
      const svc = buildService({
        repo,
        prisma,
        validation: { validateInvoiceFields },
      });

      await svc.createInvoice('tenant-1', 'SANDBOX', 'user:test', {
        seller: { tin: '123', partyName: 'Seller' },
        buyer: { partyName: 'Buyer' },
        issueDate: new Date().toISOString(),
        lineItems: [makeFlatLineItem()],
        taxTotal: [],
        legalMonetaryTotal: { payableAmount: 1075 },
      });

      const validatedLineItems =
        validateInvoiceFields.mock.calls[0][0].lineItems;
      expect(validatedLineItems[0].invoicedQuantity).toBe(2);
      expect(validatedLineItems[0].hsnCode).toBe('HSN001');

      const storedLineItems = createMock.mock.calls[0][0].lineItems;
      expect(storedLineItems[0].invoicedQuantity).toBe(2);
      expect(storedLineItems[0].price.priceAmount).toBe(500);
      expect(storedLineItems[0].hsnCode).toBe('HSN001');
    });
  });

  describe('submitDraft()', () => {
    it('normalises effectiveLineItems before validation AND before the write', async () => {
      const draftInvoice = makeInvoiceRecord();
      let updateData: any;
      const findByIdMock = jest
        .fn()
        .mockResolvedValueOnce(draftInvoice)
        .mockResolvedValueOnce(draftInvoice);
      const repo = { findById: findByIdMock };
      const validateInvoiceFields = jest.fn();
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            invoice: {
              update: jest.fn().mockImplementation(({ data }: any) => {
                updateData = data;
                return Promise.resolve({ ...draftInvoice, ...data });
              }),
            },
            tenant: {
              findUnique: jest.fn().mockResolvedValue({
                appAdapterKey: 'mock',
                interswitchClientId: null,
              }),
            },
          }),
        ),
      };
      const svc = buildService({
        repo,
        prisma,
        validation: { validateInvoiceFields },
      });

      await svc.submitDraft('inv-1', 'tenant-1', 'user:test', {
        lineItems: [makeFlatLineItem()],
      });

      const validatedLineItems =
        validateInvoiceFields.mock.calls[0][0].lineItems;
      expect(validatedLineItems[0].invoicedQuantity).toBe(2);
      expect(validatedLineItems[0].hsnCode).toBe('HSN001');

      expect(updateData.lineItems[0].invoicedQuantity).toBe(2);
      expect(updateData.lineItems[0].price.priceAmount).toBe(500);
      expect(updateData.lineItems[0].hsnCode).toBe('HSN001');
    });
  });

  describe('saveDraftInvoice()', () => {
    it('normalises flat line items before storing a new draft', async () => {
      const createMock = jest.fn().mockResolvedValue(makeInvoiceRecord());
      const repo = {
        create: createMock,
        addStateHistory: jest.fn().mockResolvedValue({}),
      };
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            tenant: {
              findUnique: jest.fn().mockResolvedValue({
                tin: '123',
                interswitchServiceId: 'SVC1',
              }),
            },
          }),
        ),
      };
      const svc = buildService({ repo, prisma });

      await svc.saveDraftInvoice('tenant-1', 'SANDBOX', 'user:test', {
        seller: { tin: '123', partyName: 'Seller' },
        buyer: { partyName: 'Buyer' },
        lineItems: [makeFlatLineItem()],
      });

      const storedLineItems = createMock.mock.calls[0][0].lineItems;
      expect(storedLineItems[0].invoicedQuantity).toBe(2);
      expect(storedLineItems[0].price.priceAmount).toBe(500);
      expect(storedLineItems[0].hsnCode).toBe('HSN001');
    });
  });

  describe('updateDraftFields()', () => {
    it('normalises flat line items before updating an existing draft', async () => {
      const draftInvoice = makeInvoiceRecord();
      let updateData: any;
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            invoice: {
              findUnique: jest.fn().mockResolvedValue(draftInvoice),
              update: jest.fn().mockImplementation(({ data }: any) => {
                updateData = data;
                return Promise.resolve({ ...draftInvoice, ...data });
              }),
            },
          }),
        ),
      };
      const svc = buildService({ prisma });

      await svc.updateDraftFields('inv-1', 'tenant-1', 'user:test', {
        lineItems: [makeFlatLineItem()],
      });

      expect(updateData.lineItems[0].invoicedQuantity).toBe(2);
      expect(updateData.lineItems[0].price.priceAmount).toBe(500);
      expect(updateData.lineItems[0].hsnCode).toBe('HSN001');
    });

    it('leaves stored line items untouched when the request omits lineItems', async () => {
      const draftInvoice = makeInvoiceRecord({
        lineItems: [makeCanonicalLineItem()],
      });
      let updateData: any;
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            invoice: {
              findUnique: jest.fn().mockResolvedValue(draftInvoice),
              update: jest.fn().mockImplementation(({ data }: any) => {
                updateData = data;
                return Promise.resolve({ ...draftInvoice, ...data });
              }),
            },
          }),
        ),
      };
      const svc = buildService({ prisma });

      await svc.updateDraftFields('inv-1', 'tenant-1', 'user:test', {
        currency: 'USD',
      });

      expect(updateData.lineItems).toBe(draftInvoice.lineItems);
    });
  });

  describe('duplicateInvoice()', () => {
    it('normalises legacy flat line items copied from an existing invoice', async () => {
      const original = makeInvoiceRecord({ lineItems: [makeFlatLineItem()] });
      const createMock = jest.fn().mockResolvedValue(makeInvoiceRecord());
      const repo = {
        findById: jest.fn().mockResolvedValue(original),
        create: createMock,
        addStateHistory: jest.fn().mockResolvedValue({}),
      };
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            tenant: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ interswitchServiceId: 'SVC1' }),
            },
          }),
        ),
      };
      const svc = buildService({ repo, prisma });

      await svc.duplicateInvoice('tenant-1', 'inv-1', 'user:test', 'SANDBOX');

      const storedLineItems = createMock.mock.calls[0][0].lineItems;
      expect(storedLineItems[0].invoicedQuantity).toBe(2);
      expect(storedLineItems[0].price.priceAmount).toBe(500);
      expect(storedLineItems[0].hsnCode).toBe('HSN001');
    });

    it('leaves already-canonical line items unchanged when duplicating', async () => {
      const original = makeInvoiceRecord({
        lineItems: [makeCanonicalLineItem()],
      });
      const createMock = jest.fn().mockResolvedValue(makeInvoiceRecord());
      const repo = {
        findById: jest.fn().mockResolvedValue(original),
        create: createMock,
        addStateHistory: jest.fn().mockResolvedValue({}),
      };
      const prisma = {
        asAdmin: jest.fn((fn: any) =>
          fn({
            tenant: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ interswitchServiceId: 'SVC1' }),
            },
          }),
        ),
      };
      const svc = buildService({ repo, prisma });

      await svc.duplicateInvoice('tenant-1', 'inv-1', 'user:test', 'SANDBOX');

      const storedLineItems = createMock.mock.calls[0][0].lineItems;
      expect(storedLineItems[0].invoicedQuantity).toBe(3);
      expect(storedLineItems[0].price.priceAmount).toBe(200);
      expect(storedLineItems[0].productCategory).toBe('Electronics');
    });
  });
});

describe('InvoiceService — credit/debit note original invoice reference', () => {
  // Two tenants each own one ACCEPTED invoice. The fake findFirst applies the
  // same where-clause semantics Postgres would, so tenant isolation is tested
  // against real filtering rather than a canned return value.
  const STORE = [
    {
      tenantId: 'tenant-1',
      platformIrn: 'INV-T1-0001',
      firsConfirmedIrn: 'FIRS-T1-0001',
      issueDate: new Date('2026-10-01T00:00:00.000Z'),
      buyerName: 'Original Buyer Ltd',
      buyerTin: '11111111-0001',
      buyerEmail: null,
      metadata: {
        buyerParty: {
          partyName: 'Original Buyer Ltd',
          tin: '11111111-0001',
          email: 'ap@original.ng',
          postalAddress: { streetName: '1 Broad St', state: 'NG-LA' },
        },
      },
    },
    {
      tenantId: 'tenant-2',
      platformIrn: 'INV-T2-0001',
      firsConfirmedIrn: null,
      issueDate: new Date('2026-09-15T00:00:00.000Z'),
      buyerName: 'Other Tenant Secret Buyer Ltd',
      buyerTin: '22222222-0001',
      buyerEmail: 'secret@othertenant.ng',
      metadata: {},
    },
  ];

  function makeFindFirst() {
    return jest.fn(({ where }: any) => {
      const match = STORE.find(
        (inv) =>
          inv.tenantId === where.tenantId &&
          where.OR.some(
            (cond: any) =>
              (cond.platformIrn !== undefined &&
                cond.platformIrn === inv.platformIrn) ||
              (cond.firsConfirmedIrn !== undefined &&
                cond.firsConfirmedIrn === inv.firsConfirmedIrn),
          ),
      );
      return Promise.resolve(match ?? null);
    });
  }

  function makeCreateHarness() {
    const createMock = jest.fn().mockResolvedValue(makeInvoiceRecord());
    const findFirst = makeFindFirst();
    const validateInvoiceFields = jest.fn();
    const prisma = {
      asAdmin: jest.fn((fn: any) =>
        fn({
          invoice: { findFirst },
          tenant: {
            findUnique: jest.fn().mockResolvedValue({
              tin: '123',
              appAdapterKey: 'mock',
              interswitchServiceId: 'SVC1',
              interswitchClientId: null,
            }),
          },
        }),
      ),
    };
    const svc = buildService({
      repo: {
        findBySourceReference: jest.fn().mockResolvedValue(null),
        create: createMock,
        addStateHistory: jest.fn().mockResolvedValue({}),
      },
      prisma,
      validation: { validateInvoiceFields },
    });
    return { svc, createMock, findFirst, validateInvoiceFields };
  }

  function creditNoteRequest(overrides: Record<string, any> = {}) {
    return {
      invoiceTypeCode: '380',
      invoiceKind: 'B2B',
      originalIrn: 'INV-T1-0001',
      billingReference: [{ irn: 'INV-T1-0001', issueDate: '2020-01-01' }],
      seller: { tin: '123', partyName: 'Seller' },
      buyer: { partyName: 'Tampered Buyer Ltd', tin: '99999999-0001' },
      issueDate: '2026-11-01',
      lineItems: [makeFlatLineItem()],
      taxTotal: [],
      legalMonetaryTotal: { payableAmount: 1075 },
      ...overrides,
    };
  }

  describe('findOriginalInvoiceReference()', () => {
    it('returns the stored date and buyer snapshot for an IRN in the same tenant', async () => {
      const { svc, findFirst } = makeCreateHarness();
      const ref = await svc.findOriginalInvoiceReference(
        'tenant-1',
        'INV-T1-0001',
      );
      expect(ref).toEqual({
        originalIrn: 'INV-T1-0001',
        issueDate: '2026-10-01',
        buyer: {
          partyName: 'Original Buyer Ltd',
          tin: '11111111-0001',
          email: 'ap@original.ng',
          postalAddress: { streetName: '1 Broad St', state: 'NG-LA' },
        },
      });
      expect(findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-1');
    });

    it('also resolves by FIRS-confirmed IRN, like InterswitchAdapter', async () => {
      const { svc } = makeCreateHarness();
      const ref = await svc.findOriginalInvoiceReference(
        'tenant-1',
        'FIRS-T1-0001',
      );
      expect(ref?.issueDate).toBe('2026-10-01');
    });

    it("treats another tenant's IRN exactly like a non-existent IRN", async () => {
      const { svc } = makeCreateHarness();
      const crossTenant = await svc.findOriginalInvoiceReference(
        'tenant-1',
        'INV-T2-0001',
      );
      const missing = await svc.findOriginalInvoiceReference(
        'tenant-1',
        'INV-DOES-NOT-EXIST',
      );
      expect(crossTenant).toBeNull();
      expect(crossTenant).toEqual(missing);
    });

    it('returns null without querying for an empty or non-string IRN', async () => {
      const { svc, findFirst } = makeCreateHarness();
      expect(await svc.findOriginalInvoiceReference('tenant-1', '')).toBeNull();
      expect(
        await svc.findOriginalInvoiceReference('tenant-1', 123 as any),
      ).toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe('createInvoice()', () => {
    it('rejects a mismatched buyer and date with ORIGINAL_INVOICE_MISMATCH, naming both fields', async () => {
      const { svc, createMock } = makeCreateHarness();

      const err = await svc
        .createInvoice('tenant-1', 'SANDBOX', 'user:test', creditNoteRequest())
        .catch((e: any) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().error).toBe('ORIGINAL_INVOICE_MISMATCH');
      expect(err.getResponse().message).toContain('INV-T1-0001');
      expect(err.getResponse().message).toContain(
        'buyer name, buyer TIN, original invoice date',
      );
      expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects when only the buyer TIN differs', async () => {
      const { svc, createMock } = makeCreateHarness();
      const err = await svc
        .createInvoice(
          'tenant-1',
          'SANDBOX',
          'user:test',
          creditNoteRequest({
            buyer: { partyName: 'Original Buyer Ltd', tin: '99999999-0001' },
            billingReference: undefined,
          }),
        )
        .catch((e: any) => e);
      expect(err.getResponse().message).toContain('Mismatched: buyer TIN.');
      expect(createMock).not.toHaveBeenCalled();
    });

    it('stores the full original buyer snapshot and date when the client values match', async () => {
      const { svc, createMock, validateInvoiceFields } = makeCreateHarness();

      await svc.createInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({
          buyer: { partyName: 'Original Buyer Ltd', tin: '11111111-0001' },
          billingReference: [{ irn: 'INV-T1-0001', issueDate: '2026-10-01' }],
        }),
      );

      const stored = createMock.mock.calls[0][0];
      expect(stored.buyerName).toBe('Original Buyer Ltd');
      expect(stored.buyerTin).toBe('11111111-0001');
      expect(stored.metadata.buyerParty.partyName).toBe('Original Buyer Ltd');
      expect(stored.metadata.buyerParty.email).toBe('ap@original.ng');
      expect(stored.billingReference).toEqual([
        { irn: 'INV-T1-0001', issueDate: '2026-10-01' },
      ]);
      expect(validateInvoiceFields.mock.calls[0][0].buyer.tin).toBe(
        '11111111-0001',
      );
    });

    it('fills buyer and date from the original when the client omits them', async () => {
      const { svc, createMock } = makeCreateHarness();
      await svc.createInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({ buyer: undefined, billingReference: undefined }),
      );
      const stored = createMock.mock.calls[0][0];
      expect(stored.buyerName).toBe('Original Buyer Ltd');
      expect(stored.billingReference[0].issueDate).toBe('2026-10-01');
    });

    it('applies to debit notes too', async () => {
      const { svc, createMock } = makeCreateHarness();
      await expect(
        svc.createInvoice(
          'tenant-1',
          'SANDBOX',
          'user:test',
          creditNoteRequest({ invoiceTypeCode: '384' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
    });

    it("keeps the client's manual values when the original is not in Billinx", async () => {
      const { svc, createMock } = makeCreateHarness();
      await svc.createInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({
          originalIrn: 'EXTERNAL-IRN-001',
          billingReference: [
            { irn: 'EXTERNAL-IRN-001', issueDate: '2026-08-08' },
          ],
        }),
      );
      const stored = createMock.mock.calls[0][0];
      expect(stored.buyerName).toBe('Tampered Buyer Ltd');
      expect(stored.billingReference).toEqual([
        { irn: 'EXTERNAL-IRN-001', issueDate: '2026-08-08' },
      ]);
    });

    it("never pulls buyer data from another tenant's invoice", async () => {
      const { svc, createMock } = makeCreateHarness();
      await svc.createInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({ originalIrn: 'INV-T2-0001' }),
      );
      const stored = createMock.mock.calls[0][0];
      expect(stored.buyerName).toBe('Tampered Buyer Ltd');
      expect(JSON.stringify(stored)).not.toContain('Other Tenant Secret Buyer');
      expect(JSON.stringify(stored)).not.toContain('2026-09-15');
    });

    it('does not look up or override anything for a standard invoice', async () => {
      const { svc, createMock, findFirst } = makeCreateHarness();
      await svc.createInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({ invoiceTypeCode: '381' }),
      );
      expect(findFirst).not.toHaveBeenCalled();
      expect(createMock.mock.calls[0][0].buyerName).toBe('Tampered Buyer Ltd');
    });
  });

  describe('saveDraftInvoice()', () => {
    it('rejects a credit-note draft whose buyer differs from the original', async () => {
      const { svc, createMock } = makeCreateHarness();
      await expect(
        svc.saveDraftInvoice(
          'tenant-1',
          'SANDBOX',
          'user:test',
          creditNoteRequest(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('stores the derived billingReference and buyer on a new credit-note draft', async () => {
      const { svc, createMock } = makeCreateHarness();
      await svc.saveDraftInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({
          buyer: { partyName: 'Original Buyer Ltd', tin: '11111111-0001' },
          billingReference: [{ irn: 'INV-T1-0001', issueDate: '2026-10-01' }],
        }),
      );
      const stored = createMock.mock.calls[0][0];
      expect(stored.buyerName).toBe('Original Buyer Ltd');
      expect(stored.billingReference).toEqual([
        { irn: 'INV-T1-0001', issueDate: '2026-10-01' },
      ]);
    });

    it('stores the manual billingReference when the original is not in Billinx', async () => {
      const { svc, createMock } = makeCreateHarness();
      await svc.saveDraftInvoice(
        'tenant-1',
        'SANDBOX',
        'user:test',
        creditNoteRequest({
          originalIrn: 'EXTERNAL-IRN-001',
          billingReference: [
            { irn: 'EXTERNAL-IRN-001', issueDate: '2026-08-08' },
          ],
        }),
      );
      expect(createMock.mock.calls[0][0].billingReference).toEqual([
        { irn: 'EXTERNAL-IRN-001', issueDate: '2026-08-08' },
      ]);
    });
  });

  function makeDraftHarness(draftOverrides: Record<string, any> = {}) {
    const draft = makeInvoiceRecord({
      invoiceTypeCode: 'CREDIT_NOTE',
      originalIrn: 'INV-T1-0001',
      billingReference: null,
      metadata: { sellerParty: { partyName: 'Stored Seller' } },
      ...draftOverrides,
    });
    let updateData: any;
    const findFirst = makeFindFirst();
    const validateInvoiceFields = jest.fn();
    const prisma = {
      asAdmin: jest.fn((fn: any) =>
        fn({
          invoice: {
            findFirst,
            findUnique: jest.fn().mockResolvedValue(draft),
            update: jest.fn().mockImplementation(({ data }: any) => {
              updateData = data;
              return Promise.resolve({ ...draft, ...data });
            }),
          },
          tenant: {
            findUnique: jest.fn().mockResolvedValue({
              appAdapterKey: 'mock',
              interswitchClientId: null,
            }),
          },
        }),
      ),
    };
    const svc = buildService({
      repo: { findById: jest.fn().mockResolvedValue(draft) },
      prisma,
      validation: { validateInvoiceFields },
    });
    return { svc, getUpdate: () => updateData, validateInvoiceFields };
  }

  describe('updateDraftFields()', () => {
    it("uses the draft's stored type and IRN, and rejects a mismatched buyer before writing", async () => {
      const { svc, getUpdate } = makeDraftHarness();
      const err = await svc
        .updateDraftFields('inv-1', 'tenant-1', 'user:test', {
          buyer: { partyName: 'Tampered Buyer Ltd' },
        })
        .catch((e: any) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().message).toContain('Mismatched: buyer name.');
      expect(getUpdate()).toBeUndefined();
    });

    it('rejects a mismatched original invoice date before writing', async () => {
      const { svc, getUpdate } = makeDraftHarness();
      const err = await svc
        .updateDraftFields('inv-1', 'tenant-1', 'user:test', {
          billingReference: [{ irn: 'INV-T1-0001', issueDate: '2020-01-01' }],
        })
        .catch((e: any) => e);
      expect(err.getResponse().message).toContain(
        'Mismatched: original invoice date.',
      );
      expect(getUpdate()).toBeUndefined();
    });

    it('keeps the stored seller party when the body omits seller', async () => {
      const { svc, getUpdate } = makeDraftHarness();
      await svc.updateDraftFields('inv-1', 'tenant-1', 'user:test', {
        currency: 'NGN',
      });
      const data = getUpdate();
      expect(data.metadata.sellerParty).toEqual({ partyName: 'Stored Seller' });
      expect(data.metadata.buyerParty.partyName).toBe('Original Buyer Ltd');
    });
  });

  describe('submitDraft()', () => {
    it('rejects a mismatched buyer before validating, writing or queueing', async () => {
      const { svc, getUpdate, validateInvoiceFields } = makeDraftHarness();
      const err = await svc
        .submitDraft('inv-1', 'tenant-1', 'user:test', {
          buyer: { partyName: 'Original Buyer Ltd', tin: '99999999-0001' },
        })
        .catch((e: any) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().error).toBe('ORIGINAL_INVOICE_MISMATCH');
      expect(validateInvoiceFields).not.toHaveBeenCalled();
      expect(getUpdate()).toBeUndefined();
    });

    it('validates and writes the original buyer snapshot and date', async () => {
      const { svc, getUpdate, validateInvoiceFields } = makeDraftHarness();
      await svc.submitDraft('inv-1', 'tenant-1', 'user:test', {
        buyer: { partyName: 'Original Buyer Ltd', tin: '11111111-0001' },
        billingReference: [{ irn: 'INV-T1-0001', issueDate: '2026-10-01' }],
      });
      expect(validateInvoiceFields.mock.calls[0][0].buyer).toEqual({
        tin: '11111111-0001',
        partyName: 'Original Buyer Ltd',
      });
      const data = getUpdate();
      expect(data.buyerName).toBe('Original Buyer Ltd');
      expect(data.buyerTin).toBe('11111111-0001');
      expect(data.metadata.buyerParty.email).toBe('ap@original.ng');
      expect(data.billingReference).toEqual([
        { irn: 'INV-T1-0001', issueDate: '2026-10-01' },
      ]);
    });

    it("keeps the client's buyer when the draft references another tenant's IRN", async () => {
      const { svc, getUpdate } = makeDraftHarness({
        originalIrn: 'INV-T2-0001',
      });
      await svc.submitDraft('inv-1', 'tenant-1', 'user:test', {
        buyer: { partyName: 'Manual Buyer Ltd', tin: '33333333-0001' },
      });
      const data = getUpdate();
      expect(data.buyerName).toBe('Manual Buyer Ltd');
      expect(JSON.stringify(data)).not.toContain('Other Tenant Secret Buyer');
    });
  });
});
