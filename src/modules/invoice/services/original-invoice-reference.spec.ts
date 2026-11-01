/// <reference types="jest" />

import {
  applyOriginalInvoiceReference,
  describeOriginalInvoiceMismatch,
  findOriginalInvoiceMismatches,
  toOriginalInvoiceReference,
} from './original-invoice-reference';

function makeSnapshot(overrides: Record<string, any> = {}) {
  return {
    issueDate: new Date('2026-10-29T00:00:00.000Z'),
    buyerName: 'Zenith Merchants Ltd',
    buyerTin: '12345678-0001',
    buyerEmail: null,
    metadata: {
      buyerParty: {
        partyName: 'Zenith Merchants Ltd',
        tin: '12345678-0001',
        email: 'accounts@zenith.ng',
        telephone: '+2348000000000',
        postalAddress: {
          streetName: '10 Marina',
          state: 'NG-LA',
          lga: 'Ikeja',
        },
      },
    },
    ...overrides,
  };
}

describe('toOriginalInvoiceReference', () => {
  it('formats the issue date as UTC YYYY-MM-DD, matching InterswitchAdapter', () => {
    const ref = toOriginalInvoiceReference(
      'IRN-1',
      makeSnapshot({ issueDate: new Date('2026-10-29T23:30:00.000Z') }),
    );
    expect(ref.issueDate).toBe('2026-10-29');
    expect(ref.originalIrn).toBe('IRN-1');
  });

  it("builds the buyer from the original invoice's own snapshot", () => {
    const ref = toOriginalInvoiceReference('IRN-1', makeSnapshot());
    expect(ref.buyer).toEqual({
      partyName: 'Zenith Merchants Ltd',
      tin: '12345678-0001',
      email: 'accounts@zenith.ng',
      telephone: '+2348000000000',
      postalAddress: { streetName: '10 Marina', state: 'NG-LA', lga: 'Ikeja' },
    });
  });

  it('prefers the invoice columns over metadata.buyerParty for name, TIN and email', () => {
    const ref = toOriginalInvoiceReference(
      'IRN-1',
      makeSnapshot({
        buyerName: 'Column Name Ltd',
        buyerTin: '99999999-0001',
        buyerEmail: 'column@example.ng',
      }),
    );
    expect(ref.buyer.partyName).toBe('Column Name Ltd');
    expect(ref.buyer.tin).toBe('99999999-0001');
    expect(ref.buyer.email).toBe('column@example.ng');
  });

  it('omits TIN when the original has none (B2C), even if metadata carried one', () => {
    const ref = toOriginalInvoiceReference(
      'IRN-1',
      makeSnapshot({ buyerTin: null }),
    );
    expect(ref.buyer).not.toHaveProperty('tin');
  });

  it('handles an original with no metadata at all', () => {
    const ref = toOriginalInvoiceReference(
      'IRN-1',
      makeSnapshot({ metadata: null, buyerEmail: null }),
    );
    expect(ref.buyer).toEqual({
      partyName: 'Zenith Merchants Ltd',
      tin: '12345678-0001',
    });
  });
});

describe('findOriginalInvoiceMismatches', () => {
  const ref = toOriginalInvoiceReference('IRN-1', makeSnapshot());

  it('reports a different buyer TIN', () => {
    expect(
      findOriginalInvoiceMismatches(
        { buyer: { partyName: 'Zenith Merchants Ltd', tin: '00000000-0000' } },
        ref,
      ),
    ).toEqual(['buyer.tin']);
  });

  it('reports a different buyer name, email and original invoice date together', () => {
    expect(
      findOriginalInvoiceMismatches(
        {
          buyer: { partyName: 'Someone Else Ltd', email: 'other@else.ng' },
          billingReference: [{ irn: 'IRN-1', issueDate: '2020-01-01' }],
        },
        ref,
      ),
    ).toEqual(['buyer.partyName', 'buyer.email', 'billingReference.issueDate']);
  });

  it('reports a TIN on a note whose original buyer had none', () => {
    const b2cRef = toOriginalInvoiceReference(
      'IRN-2',
      makeSnapshot({ buyerTin: null }),
    );
    expect(
      findOriginalInvoiceMismatches(
        { buyer: { tin: '12345678-0001' } },
        b2cRef,
      ),
    ).toEqual(['buyer.tin']);
  });

  it('accepts exactly matching values (case and whitespace-insensitive for name/email)', () => {
    expect(
      findOriginalInvoiceMismatches(
        {
          buyer: {
            partyName: '  zenith merchants LTD ',
            tin: '12345678-0001',
            email: 'ACCOUNTS@zenith.ng',
          },
          billingReference: [
            { irn: 'IRN-1', issueDate: '2026-10-29T00:00:00.000Z' },
          ],
        },
        ref,
      ),
    ).toEqual([]);
  });

  it('treats omitted fields as no difference', () => {
    expect(findOriginalInvoiceMismatches({}, ref)).toEqual([]);
    expect(
      findOriginalInvoiceMismatches({ buyer: { partyName: '' } }, ref),
    ).toEqual([]);
  });

  it('ignores non-identity buyer fields such as address and phone', () => {
    expect(
      findOriginalInvoiceMismatches(
        {
          buyer: {
            tin: '12345678-0001',
            telephone: '+2349999999999',
            postalAddress: { streetName: 'Elsewhere' },
          },
        },
        ref,
      ),
    ).toEqual([]);
  });
});

describe('describeOriginalInvoiceMismatch', () => {
  it('names the original IRN, each mismatched field, and the correction route', () => {
    const message = describeOriginalInvoiceMismatch('IRN-1', [
      'buyer.tin',
      'billingReference.issueDate',
    ]);
    expect(message).toContain('IRN-1');
    expect(message).toContain('buyer TIN, original invoice date');
    expect(message).toContain('credit the original invoice in full');
  });
});

describe('applyOriginalInvoiceReference', () => {
  const ref = toOriginalInvoiceReference('IRN-1', makeSnapshot());

  it("fills the original's full buyer snapshot and date", () => {
    const request = applyOriginalInvoiceReference(
      { originalIrn: 'IRN-1', buyer: { tin: '12345678-0001' } },
      ref,
    );
    expect(request.buyer).toEqual(ref.buyer);
    expect(request.billingReference).toEqual([
      { irn: 'IRN-1', issueDate: '2026-10-29' },
    ]);
  });

  it('does not mutate the caller request', () => {
    const original = { buyer: { partyName: 'X' }, other: 1 };
    applyOriginalInvoiceReference(original, ref);
    expect(original).toEqual({ buyer: { partyName: 'X' }, other: 1 });
  });
});
