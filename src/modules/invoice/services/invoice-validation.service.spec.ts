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
  lineItems: [{ description: 'Widget', quantity: 1, unitPrice: 100 }],
  totalAmount: 100,
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

  // ── 7. VALIDATE: missing hsnCode → WARNING, not error ────────────────────────

  it('VALIDATE: emits WARNING for line items missing hsnCode', () => {
    const result = service.validateInvoiceFields(
      {
        ...validBase,
        lineItems: [
          { description: 'Widget', hsnCode: '1234' },
          { description: 'No-code item' },
        ],
      },
      'VALIDATE',
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('MISSING_HSN_CODE');
    expect(result.warnings[0].field).toBe('lineItems[1].hsnCode');
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
