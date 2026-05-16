import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { WebhookService } from '../services/webhook.service';
import { WebhookDeliveryJobData } from '../../../../packages/types/webhook';
import { WEBHOOK_QUEUE_NAME, webhookRedisConnection } from '../queues/webhook.queue';

@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorker.name);
  private worker: Worker<WebhookDeliveryJobData> | null = null;

  constructor(private readonly webhookService: WebhookService) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    this.stopWorker();
  }

  private startWorker(): void {
    try {
      this.worker = new Worker<WebhookDeliveryJobData>(
        WEBHOOK_QUEUE_NAME,
        async (job: Job<WebhookDeliveryJobData>) => {
          await this.webhookService.processDelivery(job.data.deliveryId, job.attemptsMade);
        },
        {
          connection: webhookRedisConnection,
          concurrency: 10,
          settings: {
            backoffStrategy: (attemptsMade: number) => {
              // attempt 1 fails → wait 5s; attempt 2 fails → wait 15s
              if (attemptsMade === 1) return 5_000;
              if (attemptsMade === 2) return 15_000;
              return 0;
            },
          },
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(`Webhook job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        this.logger.error(`Webhook job ${job?.id} failed: ${err.message}`);
      });

      this.worker.on('error', (err) => {
        this.logger.error(`Webhook worker error: ${err.message}`);
      });

      this.logger.log('Webhook delivery worker started');
    } catch (err: any) {
      this.logger.warn(`Webhook worker could not start (Redis unavailable): ${err.message}`);
    }
  }

  private async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Webhook delivery worker stopped');
    }
  }
}
