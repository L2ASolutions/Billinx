import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { SubmissionService } from '../services/submission.service';
import { QueueJobData } from '../../../../packages/types/submission';
import { QUEUE_NAME, redisConnection } from '../queues/submission.queue';

@Injectable()
export class SubmissionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubmissionWorker.name);
  private worker: Worker<QueueJobData> | null = null;

  constructor(private readonly submissionService: SubmissionService) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    this.stopWorker();
  }

  private startWorker(): void {
    const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '10', 10);

    try {
      this.worker = new Worker<QueueJobData>(
        QUEUE_NAME,
        async (job: Job<QueueJobData>) => {
          this.logger.log(
            `Processing job ${job.id} for invoice ${job.data.platformIrn}`,
          );
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
          `Job ${job.id} completed for invoice ${job.data.platformIrn}`,
        );
      });

      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `Job ${job?.id} failed for invoice ${job?.data?.platformIrn}: ${err.message}`,
        );
      });

      this.worker.on('error', (err) => {
        this.logger.error(`Worker error: ${err.message}`);
      });

      this.logger.log(
        `Submission worker started (concurrency: ${concurrency})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Submission worker could not start (Redis may not be available): ${err.message}`,
      );
    }
  }

  private async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Submission worker stopped');
    }
  }
}
