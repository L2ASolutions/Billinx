import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private getPeriodStart(period: string): Date {
    const now = new Date();
    if (period === 'month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), q * 3, 1);
    }
    return new Date(now.getFullYear(), 0, 1);
  }

  async topItemsSold(tenantId: string, period = 'year') {
    const since = this.getPeriodStart(period);

    const invoices = await (this.prisma as any).invoice.findMany({
      where: {
        tenantId,
        status: 'ACCEPTED',
        createdAt: { gte: since },
      },
      select: { lineItems: true, id: true },
    });

    const map = new Map<
      string,
      {
        itemName: string;
        hsnCode: string;
        totalQuantity: number;
        totalRevenue: number;
        invoiceCount: number;
        totalUnits: number;
      }
    >();

    for (const inv of invoices) {
      const lines: any[] = Array.isArray(inv.lineItems) ? inv.lineItems : [];
      for (const line of lines) {
        const name: string = line.description ?? line.itemName ?? 'Unknown';
        const qty = Number(line.quantity ?? 1);
        const revenue = Number(line.lineExtensionAmount ?? line.taxInclusiveAmount ?? 0);
        const hsn: string = line.hsnCode ?? '';

        const key = name.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.totalQuantity += qty;
          existing.totalRevenue += revenue;
          existing.invoiceCount += 1;
          existing.totalUnits += qty;
        } else {
          map.set(key, {
            itemName: name,
            hsnCode: hsn,
            totalQuantity: qty,
            totalRevenue: revenue,
            invoiceCount: 1,
            totalUnits: qty,
          });
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10)
      .map((item) => ({
        itemName: item.itemName,
        hsnCode: item.hsnCode,
        totalQuantity: item.totalQuantity,
        totalRevenue: item.totalRevenue,
        invoiceCount: item.invoiceCount,
        averagePrice: item.totalUnits > 0 ? item.totalRevenue / item.totalUnits : 0,
      }));
  }

  async topPurchases(tenantId: string, period = 'year') {
    const since = this.getPeriodStart(period);

    const invoices = await (this.prisma as any).incomingInvoice.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
      },
      select: {
        supplierName: true,
        items: {
          select: { description: true, quantity: true, lineAmount: true },
        },
      },
    });

    const map = new Map<
      string,
      {
        description: string;
        supplierName: string;
        totalQuantity: number;
        totalSpend: number;
        invoiceCount: number;
      }
    >();

    for (const inv of invoices) {
      const items: any[] = Array.isArray(inv.items) ? inv.items : [];
      for (const item of items) {
        const desc: string = item.description ?? 'Unknown';
        const qty = Number(item.quantity ?? 1);
        const spend = Number(item.lineAmount ?? 0);
        const key = desc.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.totalQuantity += qty;
          existing.totalSpend += spend;
          existing.invoiceCount += 1;
        } else {
          map.set(key, {
            description: desc,
            supplierName: inv.supplierName ?? 'Unknown',
            totalQuantity: qty,
            totalSpend: spend,
            invoiceCount: 1,
          });
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 10)
      .map((item) => ({
        description: item.description,
        supplierName: item.supplierName,
        totalQuantity: item.totalQuantity,
        totalSpend: item.totalSpend,
        invoiceCount: item.invoiceCount,
        averagePrice: item.totalQuantity > 0 ? item.totalSpend / item.totalQuantity : 0,
      }));
  }

  async topSuppliers(tenantId: string) {
    const invoices = await (this.prisma as any).incomingInvoice.findMany({
      where: { tenantId },
      select: {
        supplierName: true,
        supplierTin: true,
        invoiceAmount: true,
        createdAt: true,
      },
    });

    const map = new Map<
      string,
      {
        supplierName: string;
        supplierTin: string;
        invoiceCount: number;
        totalSpend: number;
        lastInvoiceDate: Date;
      }
    >();

    for (const inv of invoices) {
      const name: string = inv.supplierName ?? 'Unknown';
      const key = name.toLowerCase();
      const spend = Number(inv.invoiceAmount ?? 0);
      const date = new Date(inv.createdAt);
      const existing = map.get(key);
      if (existing) {
        existing.invoiceCount += 1;
        existing.totalSpend += spend;
        if (date > existing.lastInvoiceDate) existing.lastInvoiceDate = date;
      } else {
        map.set(key, {
          supplierName: name,
          supplierTin: inv.supplierTin ?? '',
          invoiceCount: 1,
          totalSpend: spend,
          lastInvoiceDate: date,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 10)
      .map((s) => ({
        supplierName: s.supplierName,
        supplierTin: s.supplierTin,
        invoiceCount: s.invoiceCount,
        totalSpend: s.totalSpend,
        lastInvoiceDate: s.lastInvoiceDate.toISOString(),
      }));
  }

  async topClients(tenantId: string) {
    const invoices = await (this.prisma as any).invoice.findMany({
      where: { tenantId, status: 'ACCEPTED' },
      select: {
        buyerName: true,
        buyerTin: true,
        totalAmount: true,
        createdAt: true,
      },
    });

    const map = new Map<
      string,
      {
        clientName: string;
        tin: string;
        invoiceCount: number;
        totalRevenue: number;
        lastInvoiceDate: Date;
      }
    >();

    for (const inv of invoices) {
      const name: string = inv.buyerName ?? 'Unknown';
      const key = name.toLowerCase();
      const revenue = Number(inv.totalAmount ?? 0);
      const date = new Date(inv.createdAt);
      const existing = map.get(key);
      if (existing) {
        existing.invoiceCount += 1;
        existing.totalRevenue += revenue;
        if (date > existing.lastInvoiceDate) existing.lastInvoiceDate = date;
      } else {
        map.set(key, {
          clientName: name,
          tin: inv.buyerTin ?? '',
          invoiceCount: 1,
          totalRevenue: revenue,
          lastInvoiceDate: date,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10)
      .map((c) => ({
        clientName: c.clientName,
        tin: c.tin,
        invoiceCount: c.invoiceCount,
        totalRevenue: c.totalRevenue,
        lastInvoiceDate: c.lastInvoiceDate.toISOString(),
      }));
  }

  async priceTrends(tenantId: string, itemName: string, months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const invoices = await (this.prisma as any).incomingInvoice.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: {
        createdAt: true,
        items: { select: { description: true, quantity: true, lineAmount: true } },
      },
    });

    const periodMap = new Map<
      string,
      { totalPrice: number; totalQty: number; invoiceCount: number }
    >();

    for (const inv of invoices) {
      const items: any[] = Array.isArray(inv.items) ? inv.items : [];
      const period = inv.createdAt.toISOString().slice(0, 7);
      for (const item of items) {
        const desc: string = item.description ?? '';
        if (!desc.toLowerCase().includes(itemName.toLowerCase())) continue;
        const qty = Number(item.quantity ?? 1);
        const spend = Number(item.lineAmount ?? 0);
        const existing = periodMap.get(period);
        if (existing) {
          existing.totalPrice += spend;
          existing.totalQty += qty;
          existing.invoiceCount += 1;
        } else {
          periodMap.set(period, { totalPrice: spend, totalQty: qty, invoiceCount: 1 });
        }
      }
    }

    return Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        period,
        averagePrice: v.totalQty > 0 ? v.totalPrice / v.totalQty : 0,
        invoiceCount: v.invoiceCount,
      }));
  }

  async revenueVsExpenses(tenantId: string, months = 6) {
    const now = new Date();
    const result: Array<{
      month: string;
      revenue: number;
      expenses: number;
      net: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleString('en-NG', { month: 'short', year: 'numeric' });

      const [revenueAgg, expensesAgg] = await Promise.all([
        (this.prisma as any).invoice.aggregate({
          where: { tenantId, status: 'ACCEPTED', createdAt: { gte: start, lt: end } },
          _sum: { totalAmount: true },
        }),
        (this.prisma as any).incomingInvoice.aggregate({
          where: { tenantId, createdAt: { gte: start, lt: end } },
          _sum: { totalAmount: true },
        }),
      ]);

      const revenue = Number(revenueAgg._sum.totalAmount ?? 0);
      const expenses = Number(expensesAgg._sum.totalAmount ?? 0);
      result.push({ month: label, revenue, expenses, net: revenue - expenses });
    }

    return result;
  }
}
