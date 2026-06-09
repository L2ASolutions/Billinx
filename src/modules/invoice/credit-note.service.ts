import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class CreditNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    tenantId: string,
    actor: string,
    originalInvoiceId: string,
    data: {
      adjustmentReason: string;
      adjustedAmount: number;
      transactionDate: Date;
    },
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: originalInvoiceId },
      select: {
        tenantId: true,
        totalAmount: true,
        buyerTin: true,
        buyerName: true,
        metadata: true,
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.tenantId !== tenantId) throw new ForbiddenException('Access denied');

    const meta: any = (invoice.metadata as any) ?? {};
    const buyerParty: any = meta.buyerParty ?? {};

    return this.prisma.creditNote.create({
      data: {
        tenantId,
        originalInvoiceId,
        adjustmentReason: data.adjustmentReason,
        originalAmount: invoice.totalAmount,
        adjustedAmount: data.adjustedAmount,
        customerTin: invoice.buyerTin ?? buyerParty.tin ?? null,
        customerName: invoice.buyerName,
        transactionDate: data.transactionDate,
        createdBy: actor,
      },
    });
  }

  async findByPeriod(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return this.prisma.creditNote.findMany({
      where: {
        tenantId,
        transactionDate: { gte: startDate, lte: endDate },
      },
      orderBy: { transactionDate: 'desc' },
    });
  }
}
