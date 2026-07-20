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
