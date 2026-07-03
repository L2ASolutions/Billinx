import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { InvoiceFilterParams } from '../../../../packages/types/invoice';

@Injectable()
export class InvoiceRepository {
  private readonly logger = new Logger(InvoiceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoice.create({ data });
    });
  }

  async findById(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findUnique({
        where: { id },
        include: {
          stateHistory: { orderBy: { createdAt: 'asc' } },
          submissionAttempts: { orderBy: { createdAt: 'asc' } },
          creditNotes: { orderBy: { transactionDate: 'asc' } },
        },
      });
    });
  }

  async findByIrn(platformIrn: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findUnique({
        where: { platformIrn },
        include: { stateHistory: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  async findBySourceReference(tenantId: string, sourceReference: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findFirst({
        where: { tenantId, sourceReference },
        orderBy: { createdAt: 'desc' },
        include: { stateHistory: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  async findByTenant(tenantId: string, filters: InvoiceFilterParams) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.invoiceTypeCode)
      where.invoiceTypeCode = filters.invoiceTypeCode;
    if (filters.sellerTin) where.sellerTin = filters.sellerTin;
    if (filters.buyerTin) where.buyerTin = filters.buyerTin;
    if (filters.from || filters.to) {
      where.issueDate = {};
      if (filters.from) where.issueDate.gte = new Date(filters.from);
      if (filters.to) where.issueDate.lte = new Date(filters.to);
    }
    // Dashboard filters (BUG-012)
    if (filters.search) {
      where.OR = [
        { buyerName: { contains: filters.search, mode: 'insensitive' } },
        { sellerName: { contains: filters.search, mode: 'insensitive' } },
        { platformIrn: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.isOverdue) {
      where.isOverdue = true;
      // paymentStatus is nullable and defaults to null until a payment is
      // recorded, so `{ not: 'PAID' }` alone drops those rows under SQL's
      // three-valued NULL logic — explicitly include null alongside not-PAID.
      where.AND = [
        ...(where.AND ?? []),
        { OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }] },
      ];
    }
    if (filters.forPayments) {
      where.status = {
        notIn: ['DRAFT', 'CANCELLED', 'VALIDATION_FAILED', 'SUBMISSION_FAILED', 'DEAD_LETTERED'] as any[],
      };
      where.NOT = {
        AND: [
          { buyerName: '' },
          { OR: [{ buyerTin: null }, { buyerTin: '' }] },
        ],
      };
    }

    // Single asAdmin() with sequential awaits. Concurrent $transaction calls
    // each hold ~200 MB in Prisma's query engine. Sequential queries inside
    // one transaction are safe and memory-efficient.
    const [data, total] = await this.prisma.asAdmin(async (tx) => {
      const data = await tx.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creditNotes: { select: { id: true, originalAmount: true, adjustedAmount: true } },
        },
      });
      const total = await tx.invoice.count({ where });
      return [data, total] as const;
    });

    return { data, total, page, limit };
  }

  async updateStatus(
    id: string,
    status: string,
    additionalData?: Record<string, any>,
  ) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoice.update({
        where: { id },
        data: { status: status as any, ...additionalData },
      });
    });
  }

  async addStateHistory(data: {
    invoiceId: string;
    tenantId: string;
    fromStatus?: string;
    toStatus: string;
    actor: string;
    reason?: string;
    metadata?: any;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.invoiceStateHistory.create({
        data: {
          invoiceId: data.invoiceId,
          tenantId: data.tenantId,
          fromStatus: data.fromStatus as any,
          toStatus: data.toStatus as any,
          actor: data.actor,
          reason: data.reason ?? null,
          metadata: data.metadata ?? null,
        },
      });
    });
  }

  async countByTenant(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      const total = await tx.invoice.count({ where: { tenantId } });
      const accepted = await tx.invoice.count({
        where: { tenantId, status: 'ACCEPTED' },
      });
      const rejected = await tx.invoice.count({
        where: { tenantId, status: 'REJECTED' },
      });
      const draft = await tx.invoice.count({
        where: { tenantId, status: 'DRAFT' },
      });
      return [total, accepted, rejected, draft] as const;
    });
  }
}
