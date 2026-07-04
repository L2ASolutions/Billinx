import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QueueJobData } from '../../../../packages/types/submission';
import { buildRedisConnectionOptions } from '../../../shared/redis/redis-config.factory';

const QUEUE_NAME = 'invoice-submission';

const redisConnection = buildRedisConnectionOptions();

let queueInstance: Queue<QueueJobData> | undefined;

// Lazily constructed so importing this module never opens a live Redis
// connection on its own — only actually enqueuing/inspecting a job does.
export function getSubmissionQueue(): Queue<QueueJobData> {
  queueInstance ??= new Queue<QueueJobData>(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  return queueInstance;
}

export async function addToSubmissionQueue(data: QueueJobData): Promise<void> {
  const logger = new Logger('SubmissionQueue');
  await getSubmissionQueue().add('submit-invoice', data, {
    jobId: `invoice-${data.invoiceId}-attempt-${data.attempt}`,
  });
  logger.log(`Invoice ${data.platformIrn} added to submission queue`);
}

export { QUEUE_NAME, redisConnection };
