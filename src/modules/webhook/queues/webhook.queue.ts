import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { WebhookDeliveryJobData } from '../../../../packages/types/webhook';

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

export const webhookRedisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD ?? undefined,
};

export const webhookQueue = new Queue<WebhookDeliveryJobData>(
  WEBHOOK_QUEUE_NAME,
  {
    connection: webhookRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  },
);

export async function addToWebhookQueue(
  data: WebhookDeliveryJobData,
): Promise<void> {
  const logger = new Logger('WebhookQueue');
  await webhookQueue.add('deliver-webhook', data, {
    jobId: `webhook-${data.deliveryId}`,
  });
  logger.log(`Webhook delivery ${data.deliveryId} enqueued`);
}
