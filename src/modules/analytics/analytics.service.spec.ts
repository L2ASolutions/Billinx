/// <reference types="jest" />

import { AnalyticsService } from './analytics.service';

const TENANT_ID = 'tenant-001';
const FIXED_NOW = new Date('2026-03-15T12:00:00.000Z');

describe('AnalyticsService', () => {
  let prisma: {
    invoice: { findMany: jest.Mock; aggregate: jest.Mock };
    incomingInvoice: { findMany: jest.Mock; aggregate: jest.Mock };
  };
  let service: AnalyticsService;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(FIXED_NOW);

    prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
      },
      incomingInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
      },
    };
    service = new AnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('topItemsSold', () => {
    it('scopes to ACCEPTED invoices for the tenant since the start of the year by default', async () => {
      await service.topItemsSold(TENANT_ID);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_ID,
            status: 'ACCEPTED',
            createdAt: { gte: new Date(2026, 0, 1) },
          },
        }),
      );
    });

    it('uses the start of the current month for period=month', async () => {
      await service.topItemsSold(TENANT_ID, 'month');
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(2026, 2, 1) },
          }),
        }),
      );
    });

    it('uses the start of the current quarter for period=quarter', async () => {
      await service.topItemsSold(TENANT_ID, 'quarter');
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(2026, 0, 1) },
          }),
        }),
      );
    });

    it('aggregates line items across invoices, case-insensitively by name', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          lineItems: [
            { description: 'Widget', quantity: 2, lineExtensionAmount: 200 },
          ],
        },
        {
          id: 'inv-2',
          lineItems: [
            { description: 'widget', quantity: 3, lineExtensionAmount: 300 },
          ],
        },
      ]);

      const [result] = await service.topItemsSold(TENANT_ID);

      expect(result.itemName).toBe('Widget');
      expect(result.totalQuantity).toBe(5);
      expect(result.totalRevenue).toBe(500);
      expect(result.invoiceCount).toBe(2);
      expect(result.averagePrice).toBe(100);
    });

    it('sorts by total revenue descending and caps results at 10', async () => {
      const lineItems = Array.from({ length: 12 }, (_, i) => ({
        description: `Item${i}`,
        quantity: 1,
        lineExtensionAmount: i,
      }));
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1', lineItems }]);

      const result = await service.topItemsSold(TENANT_ID);

      expect(result).toHaveLength(10);
      expect(result[0].itemName).toBe('Item11');
      expect(result[9].itemName).toBe('Item2');
    });

    it('defaults missing description/quantity/revenue to safe fallbacks', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', lineItems: [{}] },
      ]);

      const [result] = await service.topItemsSold(TENANT_ID);
      expect(result.itemName).toBe('Unknown');
      expect(result.totalQuantity).toBe(1);
      expect(result.totalRevenue).toBe(0);
      expect(result.averagePrice).toBe(0);
    });

    it('tolerates non-array lineItems', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', lineItems: null },
      ]);
      const result = await service.topItemsSold(TENANT_ID);
      expect(result).toEqual([]);
    });
  });

  describe('topPurchases', () => {
    it('aggregates incoming-invoice items by description', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        {
          supplierName: 'Acme Supplies',
          items: [{ description: 'Paper', quantity: 10, lineAmount: 100 }],
        },
      ]);

      const [result] = await service.topPurchases(TENANT_ID);
      expect(result).toMatchObject({
        description: 'Paper',
        supplierName: 'Acme Supplies',
        totalQuantity: 10,
        totalSpend: 100,
        averagePrice: 10,
      });
    });

    it('scopes to the tenant and the given period', async () => {
      await service.topPurchases(TENANT_ID, 'month');
      expect(prisma.incomingInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_ID,
            createdAt: { gte: new Date(2026, 2, 1) },
          },
        }),
      );
    });
  });

  describe('topSuppliers', () => {
    it('aggregates by supplierName and tracks the most recent invoice date', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        {
          supplierName: 'Acme',
          supplierTin: 'TIN1',
          invoiceAmount: 100,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          supplierName: 'Acme',
          supplierTin: 'TIN1',
          invoiceAmount: 50,
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]);

      const [result] = await service.topSuppliers(TENANT_ID);
      expect(result.invoiceCount).toBe(2);
      expect(result.totalSpend).toBe(150);
      expect(result.lastInvoiceDate).toBe('2026-02-01T00:00:00.000Z');
    });

    it('sorts suppliers by total spend descending', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        { supplierName: 'Small', invoiceAmount: 10, createdAt: new Date() },
        { supplierName: 'Big', invoiceAmount: 1000, createdAt: new Date() },
      ]);

      const result = await service.topSuppliers(TENANT_ID);
      expect(result[0].supplierName).toBe('Big');
    });
  });

  describe('topClients', () => {
    it('aggregates ACCEPTED invoices by buyerName', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          buyerName: 'Beta Ltd',
          buyerTin: 'TIN2',
          totalAmount: 500,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const [result] = await service.topClients(TENANT_ID);
      expect(result).toMatchObject({
        clientName: 'Beta Ltd',
        tin: 'TIN2',
        invoiceCount: 1,
        totalRevenue: 500,
      });
    });

    it('only queries ACCEPTED invoices', async () => {
      await service.topClients(TENANT_ID);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, status: 'ACCEPTED' },
        }),
      );
    });
  });

  describe('priceTrends', () => {
    it('filters items by a case-insensitive substring match on description', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-02-15T00:00:00.000Z'),
          items: [
            { description: 'Premium Widget', quantity: 2, lineAmount: 200 },
            { description: 'Unrelated Gadget', quantity: 5, lineAmount: 500 },
          ],
        },
      ]);

      const result = await service.priceTrends(TENANT_ID, 'widget');
      expect(result).toEqual([
        { period: '2026-02', averagePrice: 100, invoiceCount: 1 },
      ]);
    });

    it('groups matching items by YYYY-MM period and averages price across quantity', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-01-10T00:00:00.000Z'),
          items: [{ description: 'Widget', quantity: 2, lineAmount: 200 }],
        },
        {
          createdAt: new Date('2026-01-20T00:00:00.000Z'),
          items: [{ description: 'Widget', quantity: 3, lineAmount: 150 }],
        },
      ]);

      const result = await service.priceTrends(TENANT_ID, 'widget');
      expect(result).toEqual([
        { period: '2026-01', averagePrice: 70, invoiceCount: 2 },
      ]);
    });

    it('sorts periods chronologically', async () => {
      prisma.incomingInvoice.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          items: [{ description: 'Widget', quantity: 1, lineAmount: 10 }],
        },
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          items: [{ description: 'Widget', quantity: 1, lineAmount: 10 }],
        },
      ]);

      const result = await service.priceTrends(TENANT_ID, 'widget');
      expect(result.map((r) => r.period)).toEqual(['2026-01', '2026-03']);
    });

    it('uses the months param to scope the createdAt filter', async () => {
      await service.priceTrends(TENANT_ID, 'widget', 3);
      expect(prisma.incomingInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_ID,
            createdAt: { gte: new Date(2025, 11, 15, 12) },
          },
        }),
      );
    });
  });

  describe('revenueVsExpenses', () => {
    it('returns one entry per month for the last N months, oldest first', async () => {
      const result = await service.revenueVsExpenses(TENANT_ID, 3);
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.month)).toEqual([
        'Jan 2026',
        'Feb 2026',
        'Mar 2026',
      ]);
    });

    it('computes net as revenue minus expenses per month', async () => {
      prisma.invoice.aggregate.mockResolvedValue({
        _sum: { totalAmount: 1000 },
      });
      prisma.incomingInvoice.aggregate.mockResolvedValue({
        _sum: { totalAmount: 400 },
      });

      const result = await service.revenueVsExpenses(TENANT_ID, 1);
      expect(result[0]).toEqual({
        month: 'Mar 2026',
        revenue: 1000,
        expenses: 400,
        net: 600,
      });
    });

    it('defaults revenue/expenses to 0 when there is no data for a month', async () => {
      const result = await service.revenueVsExpenses(TENANT_ID, 1);
      expect(result[0]).toMatchObject({ revenue: 0, expenses: 0, net: 0 });
    });

    it('only counts ACCEPTED invoices for revenue', async () => {
      await service.revenueVsExpenses(TENANT_ID, 1);
      expect(prisma.invoice.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
      );
    });
  });
});
