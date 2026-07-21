import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecurringInvoiceService } from './services/recurring-invoice.service';

@Injectable()
export class RecurringInvoiceScheduler {
  private readonly logger = new Logger(RecurringInvoiceScheduler.name);

  constructor(
    private readonly recurringInvoiceService: RecurringInvoiceService,
  ) {}

  // 06:00 WAT (UTC+1) = 05:00 UTC. Mirrors the @Cron pattern already used by
  // every other daily job in this codebase (reminder.service.ts,
  // payment.service.ts, api-key.service.ts, retention.service.ts) rather
  // than a BullMQ repeatable job — there's no scheduled-job queue anywhere
  // in this app, and introducing one just for this would be inconsistent.
  @Cron('0 5 * * *', { name: 'recurring-invoice-run' })
  async runDailyRecurringInvoices(): Promise<void> {
    this.logger.log('Running daily recurring invoice generation');
    const result = await this.recurringInvoiceService.runDueSchedules();
    this.logger.log(
      `Recurring invoice run: ${result.processed} due, ${result.succeeded} succeeded, ${result.failed} failed`,
    );
  }
}
