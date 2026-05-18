import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QueueJobData } from '../../../../packages/types/submission';
import { redisConnection } from './submission.queue';

export const BULK_QUEUE_NAME = 'billinx-bulk-submission';

export const bulkSubmissionQueue = new Queue<QueueJobData>(BULK_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
    priority: 10,
  },
});

export async function addToBulkQueue(data: QueueJobData): Promise<void> {
  const logger = new Logger('BulkSubmissionQueue');
  await bulkSubmissionQueue.add('bulk-submit-invoice', data, {
    jobId: `bulk-invoice-${data.invoiceId}`,
    priority: 10,
  });
  logger.log(
    `Invoice ${data.platformIrn} added to bulk submission queue (batch ${data.batchId})`,
  );
}
