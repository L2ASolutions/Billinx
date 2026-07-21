/// <reference types="jest" />

import { RecurringInvoiceScheduler } from './recurring-invoice.scheduler';
import { RecurringInvoiceService } from './services/recurring-invoice.service';

describe('RecurringInvoiceScheduler', () => {
  it('delegates the daily run to RecurringInvoiceService.runDueSchedules', async () => {
    const service: jest.Mocked<
      Pick<RecurringInvoiceService, 'runDueSchedules'>
    > = {
      runDueSchedules: jest
        .fn()
        .mockResolvedValue({ processed: 2, succeeded: 1, failed: 1 }),
    };

    const scheduler = new RecurringInvoiceScheduler(service as any);
    await scheduler.runDailyRecurringInvoices();

    expect(service.runDueSchedules).toHaveBeenCalledTimes(1);
  });
});
