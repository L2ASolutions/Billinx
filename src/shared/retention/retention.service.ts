import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 2 * * *')
  async archiveOldInvoices(): Promise<{ archived: number }> {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

    const result = await this.prisma.asAdmin(async (tx) => {
      return (tx.invoice as any).updateMany({
        where: { isArchived: false, createdAt: { lt: sevenYearsAgo } },
        data: { isArchived: true, archivedAt: new Date() },
      });
    });
    this.logger.log(`Archived ${result.count} invoices older than 7 years`);
    return { archived: result.count };
  }

  @Cron('0 2 * * *')
  async archiveOldActivityEvents(): Promise<{ archived: number }> {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const result = await this.prisma.asAdmin(async (tx) => {
      return (tx as any).activityEvent.updateMany({
        where: { isArchived: false, occurredAt: { lt: twoYearsAgo } },
        data: { isArchived: true },
      });
    });
    this.logger.log(`Archived ${result.count} activity events older than 2 years`);
    return { archived: result.count };
  }

  async getRetentionStats(): Promise<{
    invoices: { total: number; archived: number; archiveThreshold: string };
    activityEvents: { total: number; archived: number; archiveThreshold: string };
  }> {
    const [invoiceTotal, invoiceArchived, eventTotal, eventArchived] =
      await this.prisma.asAdmin(async (tx) => {
        return Promise.all([
          tx.invoice.count(),
          (tx.invoice as any).count({ where: { isArchived: true } }),
          (tx as any).activityEvent.count(),
          (tx as any).activityEvent.count({ where: { isArchived: true } }),
        ]);
      });

    return {
      invoices: {
        total: invoiceTotal,
        archived: invoiceArchived,
        archiveThreshold: '7 years',
      },
      activityEvents: {
        total: eventTotal,
        archived: eventArchived,
        archiveThreshold: '2 years',
      },
    };
  }
}
