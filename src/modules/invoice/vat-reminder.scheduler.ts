import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getVatReminderQueue } from './vat-reminder.queue';

@Injectable()
export class VatReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(VatReminderScheduler.name);

  async onModuleInit() {
    const queue = getVatReminderQueue();

    // Remove stale copies so config changes take effect on restart
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === 'vat-return-reminder') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    await queue.add(
      'vat-return-reminder',
      {},
      {
        repeat: { pattern: '0 9 15 * *' },
      },
    );

    this.logger.log('VAT reminder repeatable job registered (0 9 15 * *)');
  }
}
