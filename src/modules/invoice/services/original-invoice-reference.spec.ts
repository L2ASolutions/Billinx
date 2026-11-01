/// <reference types="jest" />

import {
  applyOriginalInvoiceReference,
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

describe('applyOriginalInvoiceReference', () => {
  const ref = toOriginalInvoiceReference('IRN-1', makeSnapshot());

  it('overrides a mismatched client buyer and date with the stored values', () => {
    const { request, overriddenFields } = applyOriginalInvoiceReference(
      {
        invoiceTypeCode: '380',
        originalIrn: 'IRN-1',
        buyer: { partyName: 'Someone Else Ltd', tin: '00000000-0000' },
        billingReference: [{ irn: 'IRN-1', issueDate: '2020-01-01' }],
      },
      ref,
    );
    expect(request.buyer).toEqual(ref.buyer);
    expect(request.billingReference).toEqual([
      { irn: 'IRN-1', issueDate: '2026-10-29' },
    ]);
    expect(overriddenFields).toEqual(['buyer', 'billingReference.issueDate']);
  });

  it('reports nothing overridden when the client already sent matching values', () => {
    const { request, overriddenFields } = applyOriginalInvoiceReference(
      {
        buyer: { ...ref.buyer },
        billingReference: [{ irn: 'IRN-1', issueDate: '2026-10-29' }],
      },
      ref,
    );
    expect(overriddenFields).toEqual([]);
    expect(request.billingReference).toEqual([
      { irn: 'IRN-1', issueDate: '2026-10-29' },
    ]);
  });

  it('fills buyer and date when the client sent neither', () => {
    const { request, overriddenFields } = applyOriginalInvoiceReference(
      { originalIrn: 'IRN-1' },
      ref,
    );
    expect(request.buyer).toEqual(ref.buyer);
    expect(request.billingReference[0].issueDate).toBe('2026-10-29');
    expect(overriddenFields).toEqual([]);
  });

  it('does not mutate the caller request', () => {
    const original = { buyer: { partyName: 'X' }, other: 1 };
    applyOriginalInvoiceReference(original, ref);
    expect(original).toEqual({ buyer: { partyName: 'X' }, other: 1 });
  });
});
