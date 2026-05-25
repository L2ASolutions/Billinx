import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { SubmissionService } from '../services/submission.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { QueueJobData } from '../../../../packages/types/submission';
import { BULK_QUEUE_NAME } from '../queues/bulk-submission.queue';
import { redisConnection } from '../queues/submission.queue';

@Injectable()
export class BulkSubmissionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BulkSubmissionWorker.name);
  private worker: Worker<QueueJobData> | null = null;

  constructor(
    private readonly submissionService: SubmissionService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    void this.stopWorker();
  }

  private startWorker(): void {
    const concurrency = parseInt(
      process.env.BULK_WORKER_CONCURRENCY ?? '5',
      10,
    );

    try {
      this.worker = new Worker<QueueJobData>(
        BULK_QUEUE_NAME,
        async (job: Job<QueueJobData>) => {
          this.logger.log(
            `[Bulk] Processing job ${job.id} for invoice ${job.data.platformIrn} (batch ${job.data.batchId})`,
          );

          if (job.data.batchId) {
            await this.prisma.asAdmin(async (tx) => {
              return (tx as any).bulkBatch.update({
                where: { id: job.data.batchId },
                data: { processing: { increment: 1 } },
              });
            });
          }

          await this.submissionService.processSubmission(job.data);
        },
        {
          connection: redisConnection,
          concurrency,
          limiter: {
            max: 50,
            duration: 1000,
          },
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(
          `[Bulk] Job ${job.id} completed for invoice ${job.data.platformIrn}`,
        );
        if (job.data.batchId) {
          this.prisma
            .asAdmin(async (tx) => {
              return (tx as any).bulkBatch.update({
                where: { id: job.data.batchId },
                data: {
                  processing: { decrement: 1 },
                  accepted: { increment: 1 },
                },
              });
            })
            .catch((err) =>
              this.logger.error(
                `Failed to update batch ${job.data.batchId} on complete: ${err.message}`,
              ),
            );
        }
      });

      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `[Bulk] Job ${job?.id} failed for invoice ${job?.data?.platformIrn}: ${err.message}`,
        );
        if (job?.data?.batchId) {
          this.prisma
            .asAdmin(async (tx) => {
              return (tx as any).bulkBatch.update({
                where: { id: job.data.batchId },
                data: {
                  processing: { decrement: 1 },
                  failed: { increment: 1 },
                },
              });
            })
            .catch((updateErr) =>
              this.logger.error(
                `Failed to update batch ${job.data.batchId} on failure: ${updateErr.message}`,
              ),
            );
        }
      });

      this.worker.on('error', (err) => {
        this.logger.error(`[Bulk] Worker error: ${err.message}`);
      });

      this.logger.log(
        `Bulk submission worker started (concurrency: ${concurrency})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Bulk submission worker could not start (Redis may not be available): ${err.message}`,
      );
    }
  }

  private async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Bulk submission worker stopped');
    }
  }
}
