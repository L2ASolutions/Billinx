import { Queue, Worker, Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QueueJobData } from '../../../../packages/types/submission';

const QUEUE_NAME = 'invoice-submission';

const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD ?? undefined,
};

export const submissionQueue = new Queue<QueueJobData>(QUEUE_NAME, {
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

export async function addToSubmissionQueue(data: QueueJobData): Promise<void> {
  const logger = new Logger('SubmissionQueue');
  await submissionQueue.add('submit-invoice', data, {
    jobId: `invoice-${data.invoiceId}-attempt-${data.attempt}`,
  });
  logger.log(`Invoice ${data.platformIrn} added to submission queue`);
}

export { QUEUE_NAME, redisConnection };
