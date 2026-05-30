import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class VatService {
  private readonly logger = new Logger(VatService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('invoice.accepted')
  async onInvoiceAccepted(payload: { invoiceId: string; tenantId: string }) {
    try {
      await this.createOutputEntry(payload.invoiceId, payload.tenantId);
    } catch (err) {
      this.logger.error(
        `Failed to create VAT output entry for invoice ${payload.invoiceId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('incoming-invoice.validated')
  async onIncomingInvoiceValidated(payload: {
    incomingInvoiceId: string;
    tenantId: string;
  }) {
    try {
      await this.createInputEntry(payload.incomingInvoiceId, payload.tenantId);
    } catch (err) {
      this.logger.error(
        `Failed to create VAT input entry for incoming invoice ${payload.incomingInvoiceId}: ${String(err)}`,
      );
    }
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private toPeriod(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  async createOutputEntry(invoiceId: string, tenantId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        vatAmount: true,
        subtotal: true,
        issueDate: true,
        sellerTin: true,
        buyerTin: true,
      },
    });
    if (!invoice) return;

    const period = this.toPeriod(invoice.issueDate);
    await (this.prisma as any).vatEntry.create({
      data: {
        tenantId,
        type: 'OUTPUT',
        invoiceId,
        buyerTin: invoice.buyerTin ?? null,
        taxableAmount: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        vatRate: 7.5,
        invoiceDate: invoice.issueDate,
        period,
        status: 'UNRECONCILED',
      },
    });
  }

  async createInputEntry(
    incomingInvoiceId: string,
    tenantId: string,
  ): Promise<void> {
    const invoice = await (this.prisma as any).incomingInvoice.findUnique({
      where: { id: incomingInvoiceId },
      select: {
        id: true,
        vatAmount: true,
        invoiceAmount: true,
        invoiceDate: true,
        supplierTin: true,
      },
    });
    if (!invoice) return;

    const period = this.toPeriod(invoice.invoiceDate);
    await (this.prisma as any).vatEntry.create({
      data: {
        tenantId,
        type: 'INPUT',
        incomingInvoiceId,
        supplierTin: invoice.supplierTin ?? null,
        taxableAmount: invoice.invoiceAmount,
        vatAmount: invoice.vatAmount,
        vatRate: 7.5,
        invoiceDate: invoice.invoiceDate,
        period,
        status: 'UNRECONCILED',
      },
    });
  }

  async getSummary(tenantId: string, period: string) {
    const [outputAgg, inputAgg, unreconciledCount] = await this.prisma.asAdmin(
      async (tx) => {
        const outputAgg = await (tx as any).vatEntry.aggregate({
          where: { tenantId, period, type: 'OUTPUT' },
          _sum: { vatAmount: true },
          _count: { id: true },
        });
        const inputAgg = await (tx as any).vatEntry.aggregate({
          where: { tenantId, period, type: 'INPUT' },
          _sum: { vatAmount: true },
          _count: { id: true },
        });
        const unreconciledCount = await (tx as any).vatEntry.count({
          where: { tenantId, period, status: 'UNRECONCILED' },
        });
        return [outputAgg, inputAgg, unreconciledCount] as const;
      },
    );

    const outputVat = Number(outputAgg._sum.vatAmount ?? 0);
    const inputVat = Number(inputAgg._sum.vatAmount ?? 0);
    const netVat = outputVat - inputVat;

    const [outputVatOutstanding, inputVatOutstanding] =
      await this.prisma.asAdmin(async (tx) => {
        const outAgg = await tx.invoice.aggregate({
          where: {
            tenantId,
            status: 'ACCEPTED',
            OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }],
          },
          _sum: { vatAmount: true },
        });
        const inAgg = await (tx as any).incomingInvoice.aggregate({
          where: { tenantId, status: { in: ['VALIDATED', 'APPROVED'] } },
          _sum: { vatAmount: true },
        });
        return [
          Number(outAgg._sum.vatAmount ?? 0),
          Number(inAgg._sum.vatAmount ?? 0),
        ] as const;
      });

    const periodRecord = await (this.prisma as any).vatPeriodSummary.findUnique(
      {
        where: { tenantId_period: { tenantId, period } },
      },
    );

    return {
      period,
      outputVat,
      inputVat,
      netVat,
      outputVatOutstanding,
      inputVatOutstanding,
      netVatExposure: outputVatOutstanding - inputVatOutstanding,
      outputCount: outputAgg._count.id,
      inputCount: inputAgg._count.id,
      unreconciledCount,
      status: periodRecord?.status ?? 'OPEN',
    };
  }

  async getAnnualSummary(tenantId: string, year: number) {
    const months = Array.from(
      { length: 12 },
      (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
    );
    return Promise.all(
      months.map((period) => this.getSummary(tenantId, period)),
    );
  }

  async getEntries(
    tenantId: string,
    filters: {
      type?: string;
      period?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { type, period, status, page = 1, limit = 50 } = filters;
    const where: any = { tenantId };
    if (type) where.type = type;
    if (period) where.period = period;
    if (status) where.status = status;

    const [data, total] = await this.prisma.asAdmin(async (tx) => {
      const data = await (tx as any).vatEntry.findMany({
        where,
        orderBy: { invoiceDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await (tx as any).vatEntry.count({ where });
      return [data, total] as const;
    });

    return {
      data: data.map((e: any) => ({
        ...e,
        taxableAmount: Number(e.taxableAmount),
        vatAmount: Number(e.vatAmount),
        vatRate: Number(e.vatRate),
      })),
      total,
      page,
      limit,
    };
  }

  async reconcileEntry(entryId: string, tenantId: string) {
    const entry = await (this.prisma as any).vatEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.tenantId !== tenantId) {
      throw new NotFoundException(`VAT entry ${entryId} not found`);
    }
    return (this.prisma as any).vatEntry.update({
      where: { id: entryId },
      data: { status: 'RECONCILED', reconciledAt: new Date() },
    });
  }

  async getMismatchReport(tenantId: string, period?: string) {
    const where: any = { tenantId };
    if (period) where.period = period;

    const entries = await (this.prisma as any).vatEntry.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
    });

    const STANDARD_RATE = 7.5;
    const issues: any[] = [];

    for (const entry of entries) {
      const rate = Number(entry.vatRate);
      const taxable = Number(entry.taxableAmount);
      const vat = Number(entry.vatAmount);
      const expectedVat = Math.round(taxable * rate) / 100;
      const diff = Math.abs(vat - expectedVat);

      if (Math.abs(rate - STANDARD_RATE) > 0.01) {
        issues.push({ ...entry, issue: `Non-standard VAT rate: ${rate}%` });
      } else if (diff > 1) {
        issues.push({
          ...entry,
          issue: `VAT amount mismatch: expected ₦${expectedVat.toFixed(2)}, got ₦${vat.toFixed(2)}`,
        });
      }
    }

    return {
      period: period ?? 'all',
      count: issues.length,
      issues: issues.map((e) => ({
        ...e,
        taxableAmount: Number(e.taxableAmount),
        vatAmount: Number(e.vatAmount),
        vatRate: Number(e.vatRate),
      })),
    };
  }
}
