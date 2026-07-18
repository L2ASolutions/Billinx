import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

function taxCodeToProductCategory(taxCode: string | undefined): string {
  if (taxCode === 'E') return '1';
  if (taxCode === 'Z') return '2';
  return '0';
}

function taxCodeToVatStatus(taxCode: string | undefined): string {
  if (taxCode === 'Z') return 'Zero-Rated';
  if (taxCode === 'E') return 'VAT Exempt';
  return 'Standard-Rated';
}

export interface VatReturnData {
  period: { start: Date; end: Date };
  summary: {
    totalSales: number;
    exemptSales: number;
    zeroRatedSales: number;
    vatableSales: number;
    outputVat: number;
    totalPurchases: number;
    inputVat: number;
    netVatPayable: number;
  };
  scheduleA: {
    customerName: string;
    customerTin: string;
    productName: string;
    productCategory: string;
    productDescription: string;
    stateCode: string;
    lgaCode: string;
    amountExclVat: number;
  }[];
  scheduleB: {
    description: string;
    customerTin: string;
    customerName: string;
    transactionDate: Date;
    invoiceNumber: string;
    invoiceAmount: number;
    adjustedAmount: number;
  }[];
  scheduleC2: {
    sellerName: string;
    sellerTin: string;
    productDescription: string;
    amountExclVat: number;
    vatStatus: string;
  }[];
}

@Injectable()
export class VatReturnService {
  constructor(private readonly prisma: PrismaService) {}

  async getVatReturnData(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<VatReturnData> {
    const [sentInvoices, creditNotes, incomingInvoices] = await Promise.all([
      this.prisma.asAdmin((tx) =>
        tx.invoice.findMany({
          where: {
            tenantId,
            status: 'ACCEPTED',
            issueDate: { gte: startDate, lte: endDate },
          },
          select: {
            buyerTin: true,
            buyerName: true,
            subtotal: true,
            vatAmount: true,
            lineItems: true,
            metadata: true,
          },
        }),
      ),
      this.prisma.asAdmin((tx) =>
        tx.creditNote.findMany({
          where: {
            tenantId,
            transactionDate: { gte: startDate, lte: endDate },
          },
          include: {
            originalInvoice: { select: { platformIrn: true } },
          },
          orderBy: { transactionDate: 'asc' },
        }),
      ),
      this.prisma.asAdmin((tx) =>
        tx.incomingInvoice.findMany({
          where: {
            tenantId,
            invoiceDate: { gte: startDate, lte: endDate },
          },
          include: { items: true },
        }),
      ),
    ]);

    // ── Schedule A + summary (sent invoices) ───────────────────────────────────
    let totalSales = 0;
    let exemptSales = 0;
    let zeroRatedSales = 0;
    const scheduleA: VatReturnData['scheduleA'] = [];

    for (const inv of sentInvoices) {
      const subtotal = Number(inv.subtotal);
      totalSales += subtotal;

      const meta: any = (inv.metadata as any) ?? {};
      const buyerAddr: any = meta.buyerParty?.postalAddress ?? {};
      const stateCode: string = buyerAddr.state ?? '';
      const lgaCode: string = buyerAddr.lga ?? '';
      const customerName: string = inv.buyerName;
      const customerTin: string = inv.buyerTin ?? '';

      const lineItems: any[] = Array.isArray(inv.lineItems)
        ? inv.lineItems
        : [];

      if (lineItems.length > 0) {
        for (const li of lineItems) {
          const taxCode: string | undefined = li.taxCode;
          const productCategory = taxCodeToProductCategory(taxCode);
          const amount = Number(li.lineExtensionAmount ?? li.totalPrice ?? 0);

          if (taxCode === 'E') exemptSales += amount;
          if (taxCode === 'Z') zeroRatedSales += amount;

          const productName: string = li.item?.name ?? li.description ?? '';
          const productDescription: string =
            li.item?.description ?? li.description ?? '';

          scheduleA.push({
            customerName,
            customerTin,
            productName,
            productCategory,
            productDescription,
            stateCode,
            lgaCode,
            amountExclVat: amount,
          });
        }
      } else {
        // No line-item detail — emit one row for the whole invoice
        scheduleA.push({
          customerName,
          customerTin,
          productName: '',
          productCategory: '0',
          productDescription: '',
          stateCode,
          lgaCode,
          amountExclVat: subtotal,
        });
      }
    }

    const vatableSales = totalSales - exemptSales - zeroRatedSales;
    const outputVat = Math.round(vatableSales * 0.075 * 100) / 100;

    // ── Schedule B (credit notes) ──────────────────────────────────────────────
    const scheduleB: VatReturnData['scheduleB'] = creditNotes.map((cn) => ({
      description: cn.adjustmentReason,
      customerTin: cn.customerTin ?? '',
      customerName: cn.customerName,
      transactionDate: cn.transactionDate,
      invoiceNumber: cn.originalInvoice.platformIrn,
      invoiceAmount: Number(cn.originalAmount),
      adjustedAmount: Number(cn.adjustedAmount),
    }));

    // ── Schedule C2 + summary (received invoices) ──────────────────────────────
    let totalPurchases = 0;
    let inputVat = 0;
    const scheduleC2: VatReturnData['scheduleC2'] = [];

    for (const inv of incomingInvoices) {
      const invVat = Number(inv.vatAmount);
      const invAmount = Number(inv.invoiceAmount);
      const amountExcl = invAmount - invVat;
      totalPurchases += amountExcl;
      inputVat += invVat;

      if (inv.items.length > 0) {
        for (const item of inv.items) {
          const itemVat = Number(item.vatAmount);
          const itemAmount = Number(item.lineAmount) - itemVat;
          const vatStatus = taxCodeToVatStatus(itemVat > 0 ? 'S' : 'Z');
          scheduleC2.push({
            sellerName: inv.supplierName,
            sellerTin: inv.supplierTin,
            productDescription: item.description,
            amountExclVat: itemAmount,
            vatStatus,
          });
        }
      } else {
        const vatStatus = taxCodeToVatStatus(invVat > 0 ? 'S' : 'Z');
        scheduleC2.push({
          sellerName: inv.supplierName,
          sellerTin: inv.supplierTin,
          productDescription: inv.description ?? '',
          amountExclVat: amountExcl,
          vatStatus,
        });
      }
    }

    const netVatPayable = Math.round((outputVat - inputVat) * 100) / 100;

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalSales,
        exemptSales,
        zeroRatedSales,
        vatableSales,
        outputVat,
        totalPurchases,
        inputVat,
        netVatPayable,
      },
      scheduleA,
      scheduleB,
      scheduleC2,
    };
  }
}
