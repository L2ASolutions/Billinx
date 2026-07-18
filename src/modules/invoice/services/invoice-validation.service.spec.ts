import { BadRequestException } from '@nestjs/common';
import {
  InvoiceValidationService,
  InvoiceValidationDto,
} from './invoice-validation.service';

const validBase: InvoiceValidationDto = {
  invoiceTypeCode: 'STANDARD',
  invoiceKind: 'B2C',
  seller: { tin: '12345678-0001', partyName: 'Acme Ltd' },
  buyer: { partyName: 'John Doe' },
  issueDate: '2026-07-10',
  lineItems: [
    {
      description: 'Widget',
      quantity: 1,
      unitPrice: 100,
      hsnCode: '1234',
      productCategory: 'Widgets',
    },
  ],
  totalAmount: 100,
  legalMonetaryTotal: {
    lineExtensionAmount: 100,
    taxExclusiveAmount: 100,
    taxInclusiveAmount: 107.5,
    payableAmount: 107.5,
  },
  taxTotal: [
    {
      taxAmount: 7.5,
      taxSubtotal: [
        { taxableAmount: 100, taxAmount: 7.5, taxCategory: { id: 'VAT' } },
      ],
    },
  ],
  paymentStatus: 'PENDING',
};

describe('InvoiceValidationService', () => {
  let service: InvoiceValidationService;

  beforeEach(() => {
    service = new InvoiceValidationService();
  });

  // ── 1. VALIDATE context: passes with all required fields ─────────────────────

  it('VALIDATE: returns valid=true when all required fields are present', () => {
    const result = service.validateInvoiceFields(validBase, 'VALIDATE');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── 2. VALIDATE context: collects errors for missing core fields ─────────────

  it('VALIDATE: collects errors for missing seller.tin, seller.partyName, buyer.partyName, issueDate', () => {
    const result = service.validateInvoiceFields(
      {
        invoiceKind: 'B2C',
        lineItems: [{ description: 'x' }],
        totalAmount: 50,
      },
      'VALIDATE',
    );
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('MISSING_SELLER_TIN');
    expect(codes).toContain('MISSING_SELLER_NAME');
    expect(codes).toContain('MISSING_BUYER_NAME');
    expect(codes).toContain('MISSING_ISSUE_DATE');
  });

  // ── 3. VALIDATE: lineItems empty → ERROR (new — wasn't in validateInvoice) ──

  it('VALIDATE: returns error when lineItems is empty', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, lineItems: [] },
      'VALIDATE',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_LINE_ITEMS')).toBe(
      true,
    );
  });

  // ── 4. VALIDATE: totalAmount <= 0 → ERROR (new — wasn't in validateInvoice) ─

  it('VALIDATE: returns error when totalAmount is zero or negative', () => {
    const zero = service.validateInvoiceFields(
      { ...validBase, totalAmount: 0 },
      'VALIDATE',
    );
    expect(zero.errors.some((e) => e.code === 'INVALID_TOTAL_AMOUNT')).toBe(
      true,
    );

    const neg = service.validateInvoiceFields(
      { ...validBase, totalAmount: -5 },
      'VALIDATE',
    );
    expect(neg.errors.some((e) => e.code === 'INVALID_TOTAL_AMOUNT')).toBe(
      true,
    );
  });

  // ── 5. VALIDATE: B2B/B2G without buyer.tin → ERROR (new for VALIDATE) ───────

  it('VALIDATE: returns error for B2B invoice missing buyer.tin', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceKind: 'B2B', buyer: { partyName: 'Buyer Co' } },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'MISSING_BUYER_TIN')).toBe(
      true,
    );
  });

  it('VALIDATE: returns error for B2G invoice missing buyer.tin', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceKind: 'B2G', buyer: { partyName: 'Ministry' } },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'MISSING_BUYER_TIN')).toBe(
      true,
    );
  });

  // ── 6. VALIDATE: credit/debit note missing originalIrn → ERROR ───────────────
  //      Checks all four code forms (380, 384, CREDIT_NOTE, DEBIT_NOTE)

  it.each([['380'], ['384'], ['CREDIT_NOTE'], ['DEBIT_NOTE']])(
    'VALIDATE: returns MISSING_ORIGINAL_IRN for invoiceTypeCode=%s without originalIrn',
    (invoiceTypeCode) => {
      const result = service.validateInvoiceFields(
        { ...validBase, invoiceTypeCode, originalIrn: undefined },
        'VALIDATE',
      );
      expect(result.errors.some((e) => e.code === 'MISSING_ORIGINAL_IRN')).toBe(
        true,
      );
    },
  );

  it('VALIDATE: does NOT require originalIrn for STANDARD invoice', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceTypeCode: 'STANDARD', originalIrn: undefined },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'MISSING_ORIGINAL_IRN')).toBe(
      false,
    );
  });

  // ── 7. VALIDATE: PRODUCT/SERVICE line-item classification → hard ERROR ───────

  it('VALIDATE: returns MISSING_PRODUCT_CLASSIFICATION for a PRODUCT item missing hsnCode or productCategory', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        lineItems: [
          {
            description: 'Widget',
            hsnCode: '1234',
            productCategory: 'Widgets',
          },
          { description: 'No-code item' },
        ],
      },
      'VALIDATE',
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find(
      (e) => e.code === 'MISSING_PRODUCT_CLASSIFICATION',
    );
    expect(err).toBeDefined();
    expect(err?.field).toBe('lineItems[1]');
  });

  it('VALIDATE: returns MISSING_SERVICE_CLASSIFICATION for a SERVICE item missing isicCode or serviceCategory', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        lineItems: [{ description: 'Consulting', itemType: 'SERVICE' }],
      },
      'VALIDATE',
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === 'MISSING_SERVICE_CLASSIFICATION'),
    ).toBe(true);
  });

  it('VALIDATE: accepts a SERVICE item with isicCode and serviceCategory', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        lineItems: [
          {
            description: 'Consulting',
            itemType: 'SERVICE',
            isicCode: '6201',
            serviceCategory: 'Software Consulting',
          },
        ],
      },
      'VALIDATE',
    );
    expect(
      result.errors.some(
        (e) =>
          e.code === 'MISSING_SERVICE_CLASSIFICATION' ||
          e.code === 'MISSING_PRODUCT_CLASSIFICATION',
      ),
    ).toBe(false);
  });

  // ── invoiceKind: hard presence + enum check ───────────────────────────────

  it('VALIDATE: returns MISSING_INVOICE_KIND when invoiceKind is absent', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceKind: undefined },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'MISSING_INVOICE_KIND')).toBe(
      true,
    );
  });

  it('VALIDATE: returns MISSING_INVOICE_KIND when invoiceKind is not B2B/B2C/B2G', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceKind: 'BOGUS' },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'MISSING_INVOICE_KIND')).toBe(
      true,
    );
  });

  it('CREATE: throws when invoiceKind is missing', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, invoiceKind: undefined },
        'CREATE',
      ),
    ).toThrow(BadRequestException);
  });

  // ── invoiceTypeCode: must be a recognised code ────────────────────────────

  it('VALIDATE: returns INVALID_INVOICE_TYPE_CODE for an unrecognised invoiceTypeCode', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, invoiceTypeCode: 'BOGUS' },
      'VALIDATE',
    );
    expect(
      result.errors.some((e) => e.code === 'INVALID_INVOICE_TYPE_CODE'),
    ).toBe(true);
  });

  it('CREATE: throws for an unrecognised invoiceTypeCode', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, invoiceTypeCode: 'BOGUS' },
        'CREATE',
      ),
    ).toThrow(BadRequestException);
  });

  it.each([['381'], ['380'], ['384'], ['390'], ['PROFORMA']])(
    'VALIDATE: accepts recognised invoiceTypeCode %s',
    (invoiceTypeCode) => {
      const result = service.validateInvoiceFields(
        {
          ...validBase,
          invoiceTypeCode,
          originalIrn:
            invoiceTypeCode === '380' || invoiceTypeCode === '384'
              ? 'ORIGINAL-IRN'
              : undefined,
        },
        'VALIDATE',
      );
      expect(
        result.errors.some((e) => e.code === 'INVALID_INVOICE_TYPE_CODE'),
      ).toBe(false);
    },
  );

  // ── paymentStatus: must be PENDING/PAID/PARTIAL when provided ────────────

  it('VALIDATE: returns INVALID_PAYMENT_STATUS for an unrecognised paymentStatus', () => {
    const result = service.validateInvoiceFields(
      { ...validBase, paymentStatus: 'UNPAID' },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'INVALID_PAYMENT_STATUS')).toBe(
      true,
    );
  });

  it('CREATE: throws for an unrecognised paymentStatus', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, paymentStatus: 'OVERDUE' },
        'CREATE',
      ),
    ).toThrow(BadRequestException);
  });

  it('CREATE: does not throw when paymentStatus is omitted', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, paymentStatus: undefined },
        'CREATE',
      ),
    ).not.toThrow();
  });

  // ── tax category: must be a recognised (or aliased) id ────────────────────

  it('VALIDATE: returns INVALID_TAX_CATEGORY for an unrecognised tax category id', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        taxTotal: [
          {
            taxAmount: 7.5,
            taxSubtotal: [
              {
                taxableAmount: 100,
                taxAmount: 7.5,
                taxCategory: { id: 'BOGUS' },
              },
            ],
          },
        ],
      },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'INVALID_TAX_CATEGORY')).toBe(
      true,
    );
  });

  it('SUBMIT: throws for an unrecognised tax category id', () => {
    expect(() =>
      service.validateInvoiceFields(
        {
          ...validBase,
          taxTotal: [
            {
              taxAmount: 7.5,
              taxSubtotal: [
                {
                  taxableAmount: 100,
                  taxAmount: 7.5,
                  taxCategory: { id: 'NOT_A_CATEGORY' },
                },
              ],
            },
          ],
        },
        'SUBMIT',
      ),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['VAT'],
    ['ZERO_VAT'],
    ['WHT'],
    ['Withholding_Tax'],
    ['Stamp_Duty'],
    ['EXEMPTED'],
  ])('VALIDATE: accepts tax category alias %s', (id) => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        taxTotal: [
          {
            taxAmount: 7.5,
            taxSubtotal: [
              { taxableAmount: 100, taxAmount: 7.5, taxCategory: { id } },
            ],
          },
        ],
      },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'INVALID_TAX_CATEGORY')).toBe(
      false,
    );
  });

  // ── price_unit: must be a valid NRS code when provided ────────────────────

  it('VALIDATE: returns INVALID_PRICE_UNIT for an unrecognised price unit', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        lineItems: [
          {
            description: 'Widget',
            hsnCode: '1234',
            productCategory: 'Widgets',
            price: { priceUnit: 'BAG' },
          },
        ],
      },
      'VALIDATE',
    );
    expect(result.errors.some((e) => e.code === 'INVALID_PRICE_UNIT')).toBe(
      true,
    );
  });

  it('SUBMIT: does not throw when price_unit is omitted (defaults elsewhere)', () => {
    expect(() =>
      service.validateInvoiceFields(validBase, 'SUBMIT'),
    ).not.toThrow();
  });

  // ── legal_monetary_total: all four fields must be present and > 0 ────────

  it('VALIDATE: returns INVALID_LEGAL_MONETARY_TOTAL when a field is zero', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        legalMonetaryTotal: {
          ...validBase.legalMonetaryTotal,
          payableAmount: 0,
        },
      },
      'VALIDATE',
    );
    expect(
      result.errors.some((e) => e.code === 'INVALID_LEGAL_MONETARY_TOTAL'),
    ).toBe(true);
  });

  it('SUBMIT: throws when a legal_monetary_total field is missing', () => {
    expect(() =>
      service.validateInvoiceFields(
        {
          ...validBase,
          legalMonetaryTotal: {
            lineExtensionAmount: 100,
            taxExclusiveAmount: 100,
            taxInclusiveAmount: 107.5,
            // payableAmount omitted
          },
        },
        'SUBMIT',
      ),
    ).toThrow(BadRequestException);
  });

  it('CREATE: does not throw when legalMonetaryTotal is entirely absent', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, legalMonetaryTotal: undefined, taxTotal: undefined },
        'CREATE',
      ),
    ).not.toThrow();
  });

  // ── 8. CREATE context: throws for missing core fields ────────────────────────

  it('CREATE: throws BadRequestException when seller.tin is missing', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, seller: { partyName: 'Acme' } },
        'CREATE',
      ),
    ).toThrow(BadRequestException);
  });

  // ── 9. CREATE: B2B without buyer.tin → throws (new — wasn't in createInvoice)─

  it('CREATE: throws for B2B invoice without buyer.tin', () => {
    expect(() =>
      service.validateInvoiceFields(
        {
          ...validBase,
          invoiceKind: 'B2B',
          buyer: { partyName: 'Buyer Co' },
        },
        'CREATE',
      ),
    ).toThrow(BadRequestException);
  });

  // ── 10. CREATE: does NOT require lineItems or totalAmount ────────────────────

  it('CREATE: does not throw when lineItems is empty or totalAmount is 0', () => {
    expect(() =>
      service.validateInvoiceFields(
        { ...validBase, lineItems: [], totalAmount: 0 },
        'CREATE',
      ),
    ).not.toThrow();
  });

  // ── 11. SUBMIT: throws for empty lineItems AND totalAmount <= 0 ───────────────

  it('SUBMIT: throws when lineItems is empty', () => {
    expect(() =>
      service.validateInvoiceFields({ ...validBase, lineItems: [] }, 'SUBMIT'),
    ).toThrow(BadRequestException);
  });

  it('SUBMIT: throws when totalAmount is zero', () => {
    expect(() =>
      service.validateInvoiceFields({ ...validBase, totalAmount: 0 }, 'SUBMIT'),
    ).toThrow(BadRequestException);
  });

  it('SUBMIT: passes with all FIRS-ready fields', () => {
    expect(() =>
      service.validateInvoiceFields(validBase, 'SUBMIT'),
    ).not.toThrow();
  });

  // ── Credit/debit note originalIrn: all four code forms in CREATE/SUBMIT ──────

  it.each([
    ['380', 'CREATE' as const],
    ['384', 'CREATE' as const],
    ['CREDIT_NOTE', 'CREATE' as const],
    ['DEBIT_NOTE', 'CREATE' as const],
    ['380', 'SUBMIT' as const],
    ['CREDIT_NOTE', 'SUBMIT' as const],
  ])(
    '%s without originalIrn throws in %s context',
    (invoiceTypeCode, context) => {
      expect(() =>
        service.validateInvoiceFields(
          { ...validBase, invoiceTypeCode, originalIrn: undefined },
          context,
        ),
      ).toThrow(BadRequestException);
    },
  );
});
