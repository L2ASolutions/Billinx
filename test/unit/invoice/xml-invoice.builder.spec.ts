/// <reference types="jest" />

import { XmlInvoiceBuilder } from '../../../src/modules/invoice/services/xml-invoice.builder';

// ---------------------------------------------------------------------------
// Shared fixture — mirrors a Billinx DB invoice record.
// ---------------------------------------------------------------------------
const SELLER = {
  tin: 'TIN-000001',
  partyName: 'Dangote Group',
  email: 'invoices@dangote.com',
  telephone: '+2348012345678',
  businessDescription: 'Cement and building materials',
  postalAddress: {
    streetName: '32 Owonikoko Street',
    cityName: 'Gwarikpa',
    postalZone: '900108',
    lga: 'NG-FC-AWU',
    state: 'NG-FC',
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
  productCategory: 'Cement and Building Materials',
  invoicedQuantity: 10,
  lineExtensionAmount: 100000.0,
  discountRate: 0,
  discountAmount: 0,
  feeRate: 0,
  feeAmount: 0,
  item: {
    name: 'Premium Cement Bags',
    description: 'High quality cement 50kg bags',
    sellersItemIdentification: 'CC-001',
  },
  price: {
    priceAmount: 10000.0,
    baseQuantity: 1,
    priceUnit: 'NGN per 1',
  },
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
    platformIrn: 'INV001-94ND90NR-20240611',
    invoiceTypeCode: 'STANDARD',
    invoiceKind: 'B2B',
    issueDate: new Date('2024-05-14'),
    currency: 'NGN',
    taxCurrencyCode: 'NGN',
    metadata: { sellerParty: SELLER, buyerParty: BUYER },
    lineItems: [LINE_ITEM],
    taxTotal: TAX_TOTAL,
    legalMonetaryTotal: LEGAL_MONETARY_TOTAL,
    paymentMeans: null,
    allowanceCharges: null,
    billingReference: null,
    documentReferences: null,
    invoiceDeliveryPeriod: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('XmlInvoiceBuilder', () => {
  let builder: XmlInvoiceBuilder;

  beforeEach(() => {
    builder = new XmlInvoiceBuilder();
  });

  // ---- Required fields -------------------------------------------------------

  describe('build() — required fields', () => {
    it('produces valid XML declaration', () => {
      const xml = builder.build(makeInvoice());
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
    });

    it('emits an <Invoice> root element', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<Invoice>');
      expect(xml).toContain('</Invoice>');
    });

    it('maps STANDARD invoiceTypeCode to NRS code 380', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<InvoiceTypeCode>380</InvoiceTypeCode>');
    });

    it('maps CREDIT_NOTE to 381', () => {
      const xml = builder.build(
        makeInvoice({ invoiceTypeCode: 'CREDIT_NOTE' }),
      );
      expect(xml).toContain('<InvoiceTypeCode>381</InvoiceTypeCode>');
    });

    it('maps DEBIT_NOTE to 383', () => {
      const xml = builder.build(makeInvoice({ invoiceTypeCode: 'DEBIT_NOTE' }));
      expect(xml).toContain('<InvoiceTypeCode>383</InvoiceTypeCode>');
    });

    it('maps PROFORMA to 325', () => {
      const xml = builder.build(makeInvoice({ invoiceTypeCode: 'PROFORMA' }));
      expect(xml).toContain('<InvoiceTypeCode>325</InvoiceTypeCode>');
    });

    it('includes IRN', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<IRN>INV001-94ND90NR-20240611</IRN>');
    });

    it('formats IssueDate as YYYY-MM-DD', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<IssueDate>2024-05-14</IssueDate>');
    });

    it('includes DocumentCurrencyCode', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<DocumentCurrencyCode>NGN</DocumentCurrencyCode>');
    });
  });

  // ---- PascalCase element names --------------------------------------------

  describe('build() — PascalCase element names', () => {
    it('uses AccountingSupplierParty (not accounting_supplier_party)', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<AccountingSupplierParty>');
      expect(xml).not.toContain('accounting_supplier_party');
    });

    it('uses AccountingCustomerParty', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<AccountingCustomerParty>');
    });

    it('uses TaxTotal and TaxSubtotal', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<TaxTotal>');
      expect(xml).toContain('<TaxSubtotal>');
    });

    it('uses LegalMonetaryTotal', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<LegalMonetaryTotal>');
    });

    it('uses InvoiceLine (not invoice_line)', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<InvoiceLine>');
      expect(xml).not.toContain('invoice_line');
    });

    it('uses PostalAddress inside party', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<PostalAddress>');
    });

    it('uses TaxCategory with ID and Percent', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<TaxCategory>');
      expect(xml).toContain('<ID>STANDARD_VAT</ID>');
      expect(xml).toContain('<Percent>7.5</Percent>');
    });

    it('uses PayableAmount inside LegalMonetaryTotal', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<PayableAmount>107500</PayableAmount>');
    });
  });

  // ---- Nested structures ---------------------------------------------------

  describe('build() — nested structures', () => {
    it('nests party fields under AccountingSupplierParty', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<PartyName>Dangote Group</PartyName>');
      expect(xml).toContain('<TIN>TIN-000001</TIN>');
      expect(xml).toContain('<Email>invoices@dangote.com</Email>');
    });

    it('nests address fields under PostalAddress', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<StreetName>32 Owonikoko Street</StreetName>');
      expect(xml).toContain('<CityName>Gwarikpa</CityName>');
      expect(xml).toContain('<Country>NG</Country>');
      expect(xml).toContain('<LGA>NG-FC-AWU</LGA>');
      expect(xml).toContain('<State>NG-FC</State>');
    });

    it('nests Item and Price inside InvoiceLine', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<Item>');
      expect(xml).toContain('<Name>Premium Cement Bags</Name>');
      expect(xml).toContain('<Price>');
      expect(xml).toContain('<PriceAmount>10000</PriceAmount>');
    });

    it('nests TaxAmount and TaxSubtotal inside TaxTotal', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).toContain('<TaxAmount>7500</TaxAmount>');
      expect(xml).toContain('<TaxableAmount>100000</TaxableAmount>');
    });
  });

  // ---- Optional fields ----------------------------------------------------

  describe('build() — optional fields', () => {
    it('omits DueDate when not set', () => {
      const xml = builder.build(makeInvoice({ dueDate: null }));
      expect(xml).not.toContain('<DueDate>');
    });

    it('includes DueDate when set', () => {
      const xml = builder.build(
        makeInvoice({ dueDate: new Date('2024-06-14') }),
      );
      expect(xml).toContain('<DueDate>2024-06-14</DueDate>');
    });

    it('includes Note when set', () => {
      const xml = builder.build(
        makeInvoice({ note: 'Payment due in 30 days' }),
      );
      expect(xml).toContain('<Note>Payment due in 30 days</Note>');
    });

    it('omits Note when null', () => {
      const xml = builder.build(makeInvoice({ note: null }));
      expect(xml).not.toContain('<Note>');
    });

    it('includes BusinessId when provided', () => {
      const xml = builder.build(
        makeInvoice(),
        '6dj03c76-1d83-4a39-a4de-51bd70547aef',
      );
      expect(xml).toContain(
        '<BusinessId>6dj03c76-1d83-4a39-a4de-51bd70547aef</BusinessId>',
      );
    });

    it('omits BusinessId when not provided', () => {
      const xml = builder.build(makeInvoice());
      expect(xml).not.toContain('<BusinessId>');
    });

    it('renders multiple InvoiceLine elements for multiple line items', () => {
      const inv = makeInvoice({
        lineItems: [LINE_ITEM, { ...LINE_ITEM, hsnCode: 'CC-002' }],
      });
      const xml = builder.build(inv);
      const matches = xml.match(/<InvoiceLine>/g) ?? [];
      expect(matches).toHaveLength(2);
    });

    it('renders PaymentMeans when present', () => {
      const inv = makeInvoice({
        paymentMeans: [
          { paymentMeansCode: '30', paymentDueDate: '2024-06-14' },
        ],
      });
      const xml = builder.build(inv);
      expect(xml).toContain('<PaymentMeans>');
      expect(xml).toContain('<PaymentMeansCode>30</PaymentMeansCode>');
      expect(xml).toContain('<PaymentDueDate>2024-06-14</PaymentDueDate>');
    });

    it('renders AllowanceCharge when present', () => {
      const inv = makeInvoice({
        allowanceCharges: [{ chargeIndicator: true, amount: 800.6 }],
      });
      const xml = builder.build(inv);
      expect(xml).toContain('<AllowanceCharge>');
      expect(xml).toContain('<ChargeIndicator>true</ChargeIndicator>');
    });

    it('renders InvoiceDeliveryPeriod when present', () => {
      const inv = makeInvoice({
        invoiceDeliveryPeriod: {
          startDate: '2024-06-14',
          endDate: '2024-06-16',
        },
      });
      const xml = builder.build(inv);
      expect(xml).toContain('<InvoiceDeliveryPeriod>');
      expect(xml).toContain('<StartDate>2024-06-14</StartDate>');
    });
  });

  // ---- Round-trip: build then parse ---------------------------------------

  describe('parse() — round-trip from XML', () => {
    it('restores invoiceTypeCode as NRS code', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(result.invoiceTypeCode).toBe('380');
    });

    it('restores seller partyName and TIN', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(result.seller.partyName).toBe('Dangote Group');
      expect(result.seller.tin).toBe('TIN-000001');
    });

    it('restores buyer partyName', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(result.buyer.partyName).toBe('TechCorp Nigeria');
    });

    it('restores lineItems array', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(Array.isArray(result.lineItems)).toBe(true);
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].hsnCode).toBe('CC-001');
      expect(result.lineItems[0].item.name).toBe('Premium Cement Bags');
    });

    it('restores taxTotal array with subtotals', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(Array.isArray(result.taxTotal)).toBe(true);
      expect(result.taxTotal[0].taxAmount).toBe(7500);
      expect(result.taxTotal[0].taxSubtotal[0].taxCategory.id).toBe(
        'STANDARD_VAT',
      );
    });

    it('restores legalMonetaryTotal', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(result.legalMonetaryTotal.payableAmount).toBe(107500);
    });

    it('restores optional Note field', () => {
      const xml = builder.build(makeInvoice({ note: 'Test note' }));
      const result = builder.parse(xml);
      expect(result.note).toBe('Test note');
    });

    it('restores postal address fields', () => {
      const xml = builder.build(makeInvoice());
      const result = builder.parse(xml);
      expect(result.seller.postalAddress.streetName).toBe(
        '32 Owonikoko Street',
      );
      expect(result.seller.postalAddress.countryCode).toBe('NG');
      expect(result.seller.postalAddress.lga).toBe('NG-FC-AWU');
    });
  });
});
