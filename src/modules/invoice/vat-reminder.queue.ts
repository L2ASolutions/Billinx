import { Queue } from 'bullmq';
import { redisConnection } from '../submission/queues/submission.queue';

export const VAT_REMINDER_QUEUE = 'vat-reminder';

export const vatReminderQueue = new Queue(VAT_REMINDER_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
});
