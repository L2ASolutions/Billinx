import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { WebhookDeliveryJobData } from '../../../../packages/types/webhook';
import { buildRedisConnectionOptions } from '../../../shared/redis/redis-config.factory';

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

export const webhookRedisConnection = buildRedisConnectionOptions();

let queueInstance: Queue<WebhookDeliveryJobData> | undefined;

// Lazily constructed so importing this module (e.g. transitively, via
// WebhookService/WebhookController) never opens a live Redis connection by
// itself — only actually enqueuing a delivery does.
function getWebhookQueue(): Queue<WebhookDeliveryJobData> {
  queueInstance ??= new Queue<WebhookDeliveryJobData>(WEBHOOK_QUEUE_NAME, {
    connection: webhookRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return queueInstance;
}

export async function addToWebhookQueue(
  data: WebhookDeliveryJobData,
): Promise<void> {
  const logger = new Logger('WebhookQueue');
  await getWebhookQueue().add('deliver-webhook', data, {
    jobId: `webhook-${data.deliveryId}`,
  });
  logger.log(`Webhook delivery ${data.deliveryId} enqueued`);
}
