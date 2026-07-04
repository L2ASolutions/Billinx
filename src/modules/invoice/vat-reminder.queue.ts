import { Queue } from 'bullmq';
import { redisConnection } from '../submission/queues/submission.queue';

export const VAT_REMINDER_QUEUE = 'vat-reminder';

let queueInstance: Queue | undefined;

// Lazily constructed so importing this module never opens a live Redis
// connection on its own — only actually enqueuing/inspecting a job does.
export function getVatReminderQueue(): Queue {
  queueInstance ??= new Queue(VAT_REMINDER_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  });
  return queueInstance;
}
