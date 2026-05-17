import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private async checkExportRateLimit(tenantId: string): Promise<void> {
    const key = `export:ratelimit:${tenantId}`;
    const client = this.redisService.client;
    const exists = await client.get(key);
    if (exists) {
      throw new HttpException(
        'Export rate limit exceeded. Please wait 60 seconds before exporting again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await client.set(key, '1', 'EX', 60);
  }

  async exportInvoicesCSV(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<string> {
    await this.checkExportRateLimit(tenantId);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        issueDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { issueDate: 'asc' },
    });

    const headers = [
      'IRN',
      'IssueDate',
      'BuyerTIN',
      'BuyerName',
      'Amount',
      'VAT',
      'Status',
      'FIRSConfirmedIRN',
      'QRCode',
    ].join(',');

    const rows = invoices.map((inv: any) => {
      return [
        inv.platformIrn,
        inv.issueDate.toISOString().split('T')[0],
        inv.buyerTin ?? '',
        inv.buyerName,
        Number(inv.totalAmount).toFixed(2),
        Number(inv.vatAmount).toFixed(2),
        inv.status,
        inv.firsConfirmedIrn ?? '',
        inv.qrCodeBase64 ? 'YES' : '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });

    return [headers, ...rows].join('\n');
  }

  async exportInvoicesJSON(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    await this.checkExportRateLimit(tenantId);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        issueDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { issueDate: 'asc' },
    });

    return invoices.map((inv: any) => ({
      irn: inv.platformIrn,
      firsConfirmedIrn: inv.firsConfirmedIrn ?? null,
      invoiceTypeCode: inv.invoiceTypeCode,
      invoiceKind: inv.invoiceKind ?? null,
      issueDate: inv.issueDate.toISOString().split('T')[0],
      dueDate: inv.dueDate?.toISOString().split('T')[0] ?? null,
      currency: inv.currency,
      sellerTin: inv.sellerTin,
      sellerName: inv.sellerName,
      buyerTin: inv.buyerTin ?? null,
      buyerName: inv.buyerName,
      subtotal: Number(inv.subtotal),
      vatAmount: Number(inv.vatAmount),
      totalAmount: Number(inv.totalAmount),
      status: inv.status,
      acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      rejectedAt: inv.rejectedAt?.toISOString() ?? null,
      lineItems: inv.lineItems,
      taxTotal: inv.taxTotal,
      legalMonetaryTotal: inv.legalMonetaryTotal,
    }));
  }

  async exportMonthlyReport(
    tenantId: string,
    year: number,
    month: number,
  ): Promise<{
    year: number;
    month: number;
    total: number;
    accepted: number;
    rejected: number;
    pending: number;
    totalAmount: number;
    vatAmount: number;
    acceptanceRate: number;
  }> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const [total, accepted, rejected, acceptedAmounts] = await Promise.all([
      this.prisma.invoice.count({
        where: { tenantId, issueDate: { gte: startDate, lte: endDate } },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          issueDate: { gte: startDate, lte: endDate },
          status: 'ACCEPTED',
        },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          issueDate: { gte: startDate, lte: endDate },
          status: 'REJECTED',
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          issueDate: { gte: startDate, lte: endDate },
          status: 'ACCEPTED',
        },
        _sum: { totalAmount: true, vatAmount: true },
      }),
    ]);

    return {
      year,
      month,
      total,
      accepted,
      rejected,
      pending: total - accepted - rejected,
      totalAmount: Number(acceptedAmounts._sum.totalAmount ?? 0),
      vatAmount: Number(acceptedAmounts._sum.vatAmount ?? 0),
      acceptanceRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
    };
  }

  async exportPlatformCSV(startDate: string, endDate: string): Promise<string> {
    const invoices = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findMany({
        where: {
          issueDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        include: { tenant: { select: { name: true, tin: true } } },
        orderBy: { issueDate: 'asc' },
      });
    });

    const headers = [
      'IRN',
      'IssueDate',
      'TenantName',
      'TenantTIN',
      'BuyerTIN',
      'BuyerName',
      'Amount',
      'VAT',
      'Status',
      'FIRSConfirmedIRN',
    ].join(',');

    const rows = (invoices as any[]).map((inv) => {
      return [
        inv.platformIrn,
        inv.issueDate.toISOString().split('T')[0],
        inv.tenant?.name ?? '',
        inv.tenant?.tin ?? '',
        inv.buyerTin ?? '',
        inv.buyerName,
        Number(inv.totalAmount).toFixed(2),
        Number(inv.vatAmount).toFixed(2),
        inv.status,
        inv.firsConfirmedIrn ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });

    return [headers, ...rows].join('\n');
  }
}
