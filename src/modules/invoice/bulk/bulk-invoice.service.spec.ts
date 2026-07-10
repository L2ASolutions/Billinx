/// <reference types="jest" />

import { BulkInvoiceService } from './bulk-invoice.service';

function makeService(): BulkInvoiceService {
  const prisma: any = { asAdmin: jest.fn() };
  const invoiceService: any = { createInvoice: jest.fn() };
  const redis: any = { checkRateLimit: jest.fn() };
  return new BulkInvoiceService(prisma, invoiceService, redis);
}

describe('BulkInvoiceService — CSV header property injection', () => {
  afterEach(() => {
    // Fail loudly (and clean up) if any test actually managed to pollute the
    // global Object.prototype — this is the property the fix guarantees.
    expect((Object.prototype as any).polluted).toBeUndefined();
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).__proto__;
  });

  it('drops malicious header names (__proto__, constructor, prototype) instead of assigning them', () => {
    const service = makeService();
    const csv =
      'seller_tin,seller_name,__proto__,constructor,prototype,subtotal\n' +
      '12345678-0001,Acme Ltd,"{""polluted"":true}","{""polluted"":true}","{""polluted"":true}",1000\n';

    const invoices = (service as any).parseCsv(csv);

    expect(invoices).toHaveLength(1);
    // Legitimate whitelisted columns still map through correctly.
    expect(invoices[0].seller.tin).toBe('12345678-0001');
    expect(invoices[0].seller.partyName).toBe('Acme Ltd');
    // Global prototype was never touched.
    expect(({} as any).polluted).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'),
    ).toBe(false);
  });

  it('builds row objects with a null prototype, so even a whitelisted-key mistake cannot pollute Object.prototype', () => {
    const service = makeService();
    const csv = 'seller_tin,seller_name\n12345678-0001,Acme Ltd\n';

    // Reach into the private per-row object the same way parseCsv does, to
    // assert the defence-in-depth property directly rather than just the
    // whitelist's observable effect.
    const rows: Record<string, string>[] = [];
    const originalMap = (service as any).mapCsvRowToInvoice.bind(service);
    (service as any).mapCsvRowToInvoice = (row: Record<string, string>) => {
      rows.push(row);
      return originalMap(row);
    };

    (service as any).parseCsv(csv);

    expect(rows).toHaveLength(1);
    expect(Object.getPrototypeOf(rows[0])).toBeNull();
  });

  it('ignores any header not on the explicit whitelist, not just the three classic pollution keys', () => {
    const service = makeService();
    const csv =
      'seller_tin,seller_name,totally_unrecognised_column\ntin-1,Acme,should-be-dropped\n';

    const invoices = (service as any).parseCsv(csv);

    expect(invoices).toHaveLength(1);
    expect(invoices[0]).not.toHaveProperty('totally_unrecognised_column');
  });
});
