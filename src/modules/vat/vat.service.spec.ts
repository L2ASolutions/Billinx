import { Test, TestingModule } from '@nestjs/testing';
import { VatService } from './vat.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

const mockPrisma = {
  asAdmin: jest.fn(),
  invoice: {
    findUnique: jest.fn(),
    aggregate: jest.fn(),
  },
};

describe('VatService', () => {
  let service: VatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VatService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<VatService>(VatService);
    jest.clearAllMocks();
  });

  describe('toPeriod (via createOutputEntry)', () => {
    it('converts a date to YYYY-MM period', async () => {
      const mockInvoice = {
        id: 'inv-1',
        vatAmount: 7500,
        subtotal: 100000,
        issueDate: new Date('2026-05-15'),
        sellerTin: '12345678-0001',
        buyerTin: '98765432-0001',
      };

      mockPrisma.invoice.findUnique.mockResolvedValue(mockInvoice);
      const createMock = jest.fn().mockResolvedValue({});
      (mockPrisma as any).vatEntry = { create: createMock };

      await service.createOutputEntry('inv-1', 'tenant-1');

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            period: '2026-05',
            type: 'OUTPUT',
          }),
        }),
      );
    });
  });

  describe('reconcileEntry', () => {
    it('throws NotFoundException if entry not found', async () => {
      (mockPrisma as any).vatEntry = {
        findUnique: jest.fn().mockResolvedValue(null),
      };

      await expect(
        service.reconcileEntry('bad-id', 'tenant-1'),
      ).rejects.toThrow('VAT entry bad-id not found');
    });

    it('throws NotFoundException if entry belongs to different tenant', async () => {
      (mockPrisma as any).vatEntry = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'e1', tenantId: 'other-tenant' }),
      };

      await expect(service.reconcileEntry('e1', 'tenant-1')).rejects.toThrow(
        'VAT entry e1 not found',
      );
    });

    it('marks entry as RECONCILED', async () => {
      const updateMock = jest
        .fn()
        .mockResolvedValue({ id: 'e1', status: 'RECONCILED' });
      (mockPrisma as any).vatEntry = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'e1', tenantId: 'tenant-1' }),
        update: updateMock,
      };

      const result = await service.reconcileEntry('e1', 'tenant-1');

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ status: 'RECONCILED' }),
        }),
      );
      expect(result.status).toBe('RECONCILED');
    });
  });

  describe('getMismatchReport', () => {
    it('flags entries with non-standard VAT rate', async () => {
      (mockPrisma as any).vatEntry = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            vatRate: 5,
            taxableAmount: 100000,
            vatAmount: 5000,
            type: 'OUTPUT',
            period: '2026-05',
            status: 'UNRECONCILED',
          },
        ]),
      };

      const report = await service.getMismatchReport('tenant-1', '2026-05');

      expect(report.count).toBe(1);
      expect(report.issues[0].issue).toMatch(/Non-standard VAT rate/);
    });

    it('flags entries where VAT amount does not match rate × taxable', async () => {
      (mockPrisma as any).vatEntry = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e2',
            vatRate: 7.5,
            taxableAmount: 100000,
            vatAmount: 5000,
            type: 'INPUT',
            period: '2026-05',
            status: 'UNRECONCILED',
          },
        ]),
      };

      const report = await service.getMismatchReport('tenant-1', '2026-05');

      expect(report.count).toBe(1);
      expect(report.issues[0].issue).toMatch(/VAT amount mismatch/);
    });

    it('returns empty issues for correct entries', async () => {
      (mockPrisma as any).vatEntry = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e3',
            vatRate: 7.5,
            taxableAmount: 100000,
            vatAmount: 7500,
            type: 'OUTPUT',
            period: '2026-05',
            status: 'UNRECONCILED',
          },
        ]),
      };

      const report = await service.getMismatchReport('tenant-1', '2026-05');

      expect(report.count).toBe(0);
      expect(report.issues).toHaveLength(0);
    });
  });
});
