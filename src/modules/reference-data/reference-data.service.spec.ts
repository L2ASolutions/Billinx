/// <reference types="jest" />

import { ReferenceDataService } from './reference-data.service';

describe('ReferenceDataService', () => {
  let prisma: {
    invoiceType: { findMany: jest.Mock };
    paymentMeans: { findMany: jest.Mock };
    taxCategory: { findMany: jest.Mock };
    currency: { findMany: jest.Mock };
    hsCode: { findMany: jest.Mock; count: jest.Mock };
    serviceCode: { findMany: jest.Mock; count: jest.Mock };
    nigerianState: { findMany: jest.Mock };
    lga: { findMany: jest.Mock };
    country: { findMany: jest.Mock };
    quantityCode: { findMany: jest.Mock };
  };
  let service: ReferenceDataService;
  let nowSpy: jest.SpyInstance;
  let currentTime: number;

  beforeEach(() => {
    prisma = {
      invoiceType: {
        findMany: jest.fn().mockResolvedValue([{ code: 'INV1' }]),
      },
      paymentMeans: {
        findMany: jest.fn().mockResolvedValue([{ code: 'PM1' }]),
      },
      taxCategory: {
        findMany: jest.fn().mockResolvedValue([{ code: 'TAX1' }]),
      },
      currency: { findMany: jest.fn().mockResolvedValue([{ code: 'NGN' }]) },
      hsCode: {
        findMany: jest.fn().mockResolvedValue([{ code: 'HS1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
      serviceCode: {
        findMany: jest.fn().mockResolvedValue([{ code: 'SC1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
      nigerianState: {
        findMany: jest.fn().mockResolvedValue([{ name: 'Lagos' }]),
      },
      lga: { findMany: jest.fn().mockResolvedValue([{ name: 'Ikeja' }]) },
      country: { findMany: jest.fn().mockResolvedValue([{ name: 'Nigeria' }]) },
      quantityCode: {
        findMany: jest.fn().mockResolvedValue([{ code: 'QC1' }]),
      },
    };
    service = new ReferenceDataService(prisma as any);

    currentTime = Date.now();
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  describe('in-process caching (invoice-types, payment-means, tax-categories, currencies, states, quantity-codes)', () => {
    it('only queries the database once for repeated calls within the 5-minute TTL', async () => {
      await service.getInvoiceTypes();
      await service.getInvoiceTypes();
      await service.getInvoiceTypes();

      expect(prisma.invoiceType.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-queries the database once the TTL has expired', async () => {
      await service.getInvoiceTypes();
      currentTime += 5 * 60 * 1000 + 1;
      await service.getInvoiceTypes();

      expect(prisma.invoiceType.findMany).toHaveBeenCalledTimes(2);
    });

    it('caches each reference-data endpoint under its own independent key', async () => {
      await service.getInvoiceTypes();
      await service.getPaymentMeans();
      await service.getTaxCategories();
      await service.getCurrencies();
      await service.getStates();
      await service.getQuantityCodes();

      // second round — all should be served from cache
      await service.getInvoiceTypes();
      await service.getPaymentMeans();
      await service.getTaxCategories();
      await service.getCurrencies();
      await service.getStates();
      await service.getQuantityCodes();

      expect(prisma.invoiceType.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.paymentMeans.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.taxCategory.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.currency.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.nigerianState.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.quantityCode.findMany).toHaveBeenCalledTimes(1);
    });

    it('orders invoice types by code ascending', async () => {
      await service.getInvoiceTypes();
      expect(prisma.invoiceType.findMany).toHaveBeenCalledWith({
        orderBy: { code: 'asc' },
      });
    });
  });

  describe('getHsCodes', () => {
    it('applies no search filter when omitted', async () => {
      await service.getHsCodes();
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('searches code/description case-insensitively when a search term is given', async () => {
      await service.getHsCodes('widget');
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { code: { contains: 'widget', mode: 'insensitive' } },
              { description: { contains: 'widget', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('defaults to limit 20 / offset 0', async () => {
      const result = await service.getHsCodes();
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 }),
      );
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('clamps an excessive limit down to 100', async () => {
      const result = await service.getHsCodes(undefined, 99999, 0);
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
      expect(result.limit).toBe(100);
    });

    it('clamps a negative limit up to at least 1', async () => {
      const result = await service.getHsCodes(undefined, -5, 0);
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
      expect(result.limit).toBe(1);
    });

    it('treats limit=0 as falsy and falls back to the 20 default', async () => {
      const result = await service.getHsCodes(undefined, 0, 0);
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
      expect(result.limit).toBe(20);
    });

    it('clamps a negative offset up to 0', async () => {
      const result = await service.getHsCodes(undefined, 20, -50);
      expect(prisma.hsCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
      expect(result.offset).toBe(0);
    });

    it('returns data alongside the total count', async () => {
      const result = await service.getHsCodes();
      expect(result.total).toBe(1);
      expect(result.data).toEqual([{ code: 'HS1' }]);
    });
  });

  describe('getServiceCodes', () => {
    it('applies the same search/pagination semantics as getHsCodes', async () => {
      await service.getServiceCodes('consult', 99999, -10);

      expect(prisma.serviceCode.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { code: { contains: 'consult', mode: 'insensitive' } },
            { description: { contains: 'consult', mode: 'insensitive' } },
          ],
        },
        orderBy: { code: 'asc' },
        take: 100,
        skip: 0,
      });
    });
  });

  describe('getLgas', () => {
    it('filters by stateCode and is not cached (always hits the database)', async () => {
      await service.getLgas('NG-LA');
      await service.getLgas('NG-LA');

      expect(prisma.lga.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.lga.findMany).toHaveBeenCalledWith({
        where: { stateCode: 'NG-LA' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getCountries', () => {
    it('uses the cache when no search term is given', async () => {
      await service.getCountries();
      await service.getCountries();
      expect(prisma.country.findMany).toHaveBeenCalledTimes(1);
    });

    it('bypasses the cache and searches name/alpha2/alpha3 when a search term is given', async () => {
      await service.getCountries('nig');
      await service.getCountries('nig');

      expect(prisma.country.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.country.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { name: { contains: 'nig', mode: 'insensitive' } },
            { alpha2: { contains: 'nig', mode: 'insensitive' } },
            { alpha3: { contains: 'nig', mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
      });
    });
  });
});
