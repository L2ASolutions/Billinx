import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class ReferenceDataService {
  private cache = new Map<string, { data: unknown; at: number }>();
  private readonly TTL = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.TTL)
      return Promise.resolve(hit.data as T);
    return fn().then((data) => {
      this.cache.set(key, { data, at: Date.now() });
      return data;
    });
  }

  getInvoiceTypes() {
    return this.cached('invoice-types', () =>
      this.prisma.invoiceType.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  getPaymentMeans() {
    return this.cached('payment-means', () =>
      this.prisma.paymentMeans.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  getTaxCategories() {
    return this.cached('tax-categories', () =>
      this.prisma.taxCategory.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  getCurrencies() {
    return this.cached('currencies', () =>
      this.prisma.currency.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  private clampPaging(
    limit: number,
    offset: number,
  ): { limit: number; offset: number } {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    const safeOffset = Math.max(Math.trunc(offset) || 0, 0);
    return { limit: safeLimit, offset: safeOffset };
  }

  async getHsCodes(search?: string, limit = 20, offset = 0) {
    const { limit: safeLimit, offset: safeOffset } = this.clampPaging(
      limit,
      offset,
    );
    const where: Prisma.HsCodeWhereInput = search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.hsCode.findMany({
        where,
        orderBy: { code: 'asc' },
        take: safeLimit,
        skip: safeOffset,
      }),
      this.prisma.hsCode.count({ where }),
    ]);
    return { data, total, limit: safeLimit, offset: safeOffset };
  }

  async getServiceCodes(search?: string, limit = 20, offset = 0) {
    const { limit: safeLimit, offset: safeOffset } = this.clampPaging(
      limit,
      offset,
    );
    const where: Prisma.ServiceCodeWhereInput = search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.serviceCode.findMany({
        where,
        orderBy: { code: 'asc' },
        take: safeLimit,
        skip: safeOffset,
      }),
      this.prisma.serviceCode.count({ where }),
    ]);
    return { data, total, limit: safeLimit, offset: safeOffset };
  }

  getStates() {
    return this.cached('states', () =>
      this.prisma.nigerianState.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  getLgas(stateCode: string) {
    return this.prisma.lga.findMany({
      where: { stateCode },
      orderBy: { name: 'asc' },
    });
  }

  async getCountries(search?: string) {
    if (!search) {
      return this.cached('countries', () =>
        this.prisma.country.findMany({ orderBy: { name: 'asc' } }),
      );
    }
    return this.prisma.country.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { alpha2: { contains: search, mode: 'insensitive' } },
          { alpha3: { contains: search, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  getQuantityCodes() {
    return this.cached('quantity-codes', () =>
      this.prisma.quantityCode.findMany({ orderBy: { code: 'asc' } }),
    );
  }
}
