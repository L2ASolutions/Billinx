/// <reference types="jest" />

import { HttpStatus } from '@nestjs/common';
import { ExportService } from './export.service';

const TENANT_ID = 'tenant-001';

function makeInvoiceRow(overrides: Record<string, any> = {}) {
  return {
    id: 'invoice-1',
    tenantId: TENANT_ID,
    platformIrn: 'IRN-001',
    firsConfirmedIrn: 'FIRS-IRN-001',
    invoiceTypeCode: '380',
    invoiceKind: 'B2B',
    issueDate: new Date('2026-01-15T00:00:00.000Z'),
    dueDate: new Date('2026-02-15T00:00:00.000Z'),
    currency: 'NGN',
    sellerTin: 'SELLER-TIN',
    sellerName: 'Seller Ltd',
    buyerTin: 'BUYER-TIN',
    buyerName: 'Buyer Ltd',
    subtotal: 1000,
    vatAmount: 75,
    totalAmount: 1075,
    status: 'ACCEPTED',
    acceptedAt: new Date('2026-01-16T00:00:00.000Z'),
    rejectedAt: null,
    lineItems: [{ description: 'Widget' }],
    taxTotal: 75,
    legalMonetaryTotal: 1075,
    qrCodeBase64: 'base64data',
    ...overrides,
  };
}

describe('ExportService', () => {
  let prisma: {
    invoice: {
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
    };
    asAdmin: jest.Mock;
  };
  let redisClient: { get: jest.Mock; set: jest.Mock };
  let redisService: { client: typeof redisClient };
  let service: ExportService;

  beforeEach(() => {
    prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([makeInvoiceRow()]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { totalAmount: null, vatAmount: null } }),
      },
      asAdmin: jest.fn().mockImplementation((fn: any) => fn(prisma)),
    };
    redisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    redisService = { client: redisClient };
    service = new ExportService(prisma as any, redisService as any);
  });

  describe('rate limiting (shared by exportInvoicesCSV/JSON)', () => {
    it('throws 429 when a rate-limit key already exists for the tenant', async () => {
      redisClient.get.mockResolvedValue('1');

      await expect(
        service.exportInvoicesCSV(TENANT_ID, '2026-01-01', '2026-01-31'),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it('sets a 60-second cooldown key after a successful export', async () => {
      await service.exportInvoicesCSV(TENANT_ID, '2026-01-01', '2026-01-31');

      expect(redisClient.set).toHaveBeenCalledWith(
        `export:ratelimit:${TENANT_ID}`,
        '1',
        'EX',
        60,
      );
    });
  });

  describe('exportInvoicesCSV', () => {
    it('scopes the query to tenantId and the issueDate range', async () => {
      await service.exportInvoicesCSV(TENANT_ID, '2026-01-01', '2026-01-31');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          issueDate: {
            gte: new Date('2026-01-01'),
            lte: new Date('2026-01-31'),
          },
        },
        orderBy: { issueDate: 'asc' },
      });
    });

    it('produces a CSV header row plus one quoted/escaped row per invoice', async () => {
      const csv = await service.exportInvoicesCSV(
        TENANT_ID,
        '2026-01-01',
        '2026-01-31',
      );
      const lines = csv.split('\n');

      expect(lines[0]).toBe(
        'IRN,IssueDate,BuyerTIN,BuyerName,Amount,VAT,Status,FIRSConfirmedIRN,QRCode',
      );
      expect(lines[1]).toBe(
        '"IRN-001","2026-01-15","BUYER-TIN","Buyer Ltd","1075.00","75.00","ACCEPTED","FIRS-IRN-001","YES"',
      );
    });

    it('escapes embedded double quotes in field values', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({ buyerName: 'Acme "The Best" Ltd' }),
      ]);

      const csv = await service.exportInvoicesCSV(
        TENANT_ID,
        '2026-01-01',
        '2026-01-31',
      );

      expect(csv).toContain('"Acme ""The Best"" Ltd"');
    });

    it('renders blank fields for missing buyerTin/firsConfirmedIrn/qrCode', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          buyerTin: null,
          firsConfirmedIrn: null,
          qrCodeBase64: null,
        }),
      ]);

      const csv = await service.exportInvoicesCSV(
        TENANT_ID,
        '2026-01-01',
        '2026-01-31',
      );
      const dataLine = csv.split('\n')[1];

      expect(dataLine).toBe(
        '"IRN-001","2026-01-15","","Buyer Ltd","1075.00","75.00","ACCEPTED","",""',
      );
    });
  });

  describe('exportInvoicesJSON', () => {
    it('scopes the query to tenantId and the issueDate range', async () => {
      await service.exportInvoicesJSON(TENANT_ID, '2026-01-01', '2026-01-31');
      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          issueDate: {
            gte: new Date('2026-01-01'),
            lte: new Date('2026-01-31'),
          },
        },
        orderBy: { issueDate: 'asc' },
      });
    });

    it('maps invoice fields including Decimal-to-number conversion and ISO date truncation', async () => {
      const [result] = await service.exportInvoicesJSON(
        TENANT_ID,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toMatchObject({
        irn: 'IRN-001',
        firsConfirmedIrn: 'FIRS-IRN-001',
        issueDate: '2026-01-15',
        dueDate: '2026-02-15',
        subtotal: 1000,
        vatAmount: 75,
        totalAmount: 1075,
        status: 'ACCEPTED',
        acceptedAt: '2026-01-16T00:00:00.000Z',
        rejectedAt: null,
      });
    });

    it('nulls dueDate/acceptedAt/rejectedAt when absent', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({ dueDate: null, acceptedAt: null }),
      ]);

      const [result] = await service.exportInvoicesJSON(
        TENANT_ID,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result.dueDate).toBeNull();
      expect(result.acceptedAt).toBeNull();
    });
  });

  describe('exportMonthlyReport', () => {
    it('computes pending as total minus accepted minus rejected', async () => {
      prisma.invoice.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6) // accepted
        .mockResolvedValueOnce(2); // rejected
      prisma.invoice.aggregate.mockResolvedValue({
        _sum: { totalAmount: 5000, vatAmount: 375 },
      });

      const result = await service.exportMonthlyReport(TENANT_ID, 2026, 3);

      expect(result.pending).toBe(2);
      expect(result.totalAmount).toBe(5000);
      expect(result.vatAmount).toBe(375);
      expect(result.acceptanceRate).toBe(60);
    });

    it('reports a 0% acceptance rate and 0 amounts when there are no invoices in the month', async () => {
      const result = await service.exportMonthlyReport(TENANT_ID, 2026, 3);
      expect(result.acceptanceRate).toBe(0);
      expect(result.totalAmount).toBe(0);
      expect(result.vatAmount).toBe(0);
    });

    it('scopes counts/aggregate to the calendar month boundaries', async () => {
      await service.exportMonthlyReport(TENANT_ID, 2026, 2);

      const totalCountCall = prisma.invoice.count.mock.calls[0][0];
      expect(totalCountCall.where.issueDate.gte).toEqual(new Date(2026, 1, 1));
      expect(totalCountCall.where.issueDate.lte).toEqual(
        new Date(2026, 2, 0, 23, 59, 59),
      );
    });
  });

  describe('exportPlatformCSV', () => {
    it('runs the query via asAdmin (cross-tenant, bypassing RLS)', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          ...makeInvoiceRow(),
          tenant: { name: 'Acme Ltd', tin: 'TENANT-TIN' },
        },
      ]);

      await service.exportPlatformCSV('2026-01-01', '2026-01-31');

      expect(prisma.asAdmin).toHaveBeenCalled();
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueDate: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-01-31'),
            },
          },
          include: { tenant: { select: { name: true, tin: true } } },
        }),
      );
    });

    it('includes TenantName/TenantTIN columns not present in the per-tenant CSV', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          ...makeInvoiceRow(),
          tenant: { name: 'Acme Ltd', tin: 'TENANT-TIN' },
        },
      ]);

      const csv = await service.exportPlatformCSV('2026-01-01', '2026-01-31');
      const [header, dataLine] = csv.split('\n');

      expect(header).toBe(
        'IRN,IssueDate,TenantName,TenantTIN,BuyerTIN,BuyerName,Amount,VAT,Status,FIRSConfirmedIRN',
      );
      expect(dataLine).toContain('"Acme Ltd"');
      expect(dataLine).toContain('"TENANT-TIN"');
    });

    it('is not subject to the per-tenant export rate limit', async () => {
      redisClient.get.mockResolvedValue('1');
      await expect(
        service.exportPlatformCSV('2026-01-01', '2026-01-31'),
      ).resolves.toBeDefined();
    });

    it('renders blank tenant columns when the tenant relation is missing', async () => {
      prisma.invoice.findMany.mockResolvedValue([makeInvoiceRow()]);

      const csv = await service.exportPlatformCSV('2026-01-01', '2026-01-31');
      const dataLine = csv.split('\n')[1];

      expect(dataLine).toBe(
        '"IRN-001","2026-01-15","","","BUYER-TIN","Buyer Ltd","1075.00","75.00","ACCEPTED","FIRS-IRN-001"',
      );
    });
  });
});
