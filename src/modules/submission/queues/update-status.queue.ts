import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { buildRedisConnectionOptions } from '../../../shared/redis/redis-config.factory';

const QUEUE_NAME = 'nrs-update-status';

const redisConnection = buildRedisConnectionOptions();

export interface UpdateStatusJobData {
  invoiceId: string;
  tenantId: string;
  irn: string;
  status: 'PAID' | 'PARTIAL';
  amount?: number;
}

// 3 attempts at 0s / 5s / 15s — a custom backoff strategy (registered on the
// Worker via `settings.backoffStrategy`, see update-status.worker.ts) since
// BullMQ's built-in 'fixed'/'exponential' backoff can't express this exact
// schedule.
export const UPDATE_STATUS_BACKOFF_DELAYS_MS = [5000, 15000];

let queueInstance: Queue<UpdateStatusJobData> | undefined;

// Lazily constructed so importing this module never opens a live Redis
// connection on its own — only actually enqueuing/inspecting a job does.
export function getUpdateStatusQueue(): Queue<UpdateStatusJobData> {
  queueInstance ??= new Queue<UpdateStatusJobData>(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  return queueInstance;
}

export async function addToUpdateStatusQueue(
  data: UpdateStatusJobData,
): Promise<void> {
  const logger = new Logger('UpdateStatusQueue');
  await getUpdateStatusQueue().add('update-status', data, {
    jobId: `update-status-${data.invoiceId}-${data.status}-${Date.now()}`,
  });
  logger.log(
    `NRS payment status update queued for invoice ${data.invoiceId}: ${data.status}`,
  );
}

export { QUEUE_NAME, redisConnection };
