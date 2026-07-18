import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { InterswitchAdapter } from '../adapters/interswitch/interswitch.adapter';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import {
  QUEUE_NAME,
  redisConnection,
  UpdateStatusJobData,
  UPDATE_STATUS_BACKOFF_DELAYS_MS,
} from '../queues/update-status.queue';

@Injectable()
export class UpdateStatusWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpdateStatusWorker.name);
  private worker: Worker<UpdateStatusJobData> | null = null;

  constructor(
    private readonly interswitchAdapter: InterswitchAdapter,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    void this.stopWorker();
  }

  private startWorker(): void {
    try {
      this.worker = new Worker<UpdateStatusJobData>(
        QUEUE_NAME,
        async (job: Job<UpdateStatusJobData>) => {
          const { invoiceId, tenantId, irn, status, amount } = job.data;
          const success = await this.interswitchAdapter.updatePaymentStatus(
            irn,
            tenantId,
            status,
            amount,
          );
          if (!success) {
            throw new Error(
              `NRS UpdateStatus call failed for invoice ${invoiceId} (IRN ${irn})`,
            );
          }
          await this.recordOutcome(invoiceId, true);
        },
        {
          connection: redisConnection,
          concurrency: 5,
          settings: {
            backoffStrategy: (attemptsMade: number) =>
              UPDATE_STATUS_BACKOFF_DELAYS_MS[attemptsMade - 1] ??
              UPDATE_STATUS_BACKOFF_DELAYS_MS[
                UPDATE_STATUS_BACKOFF_DELAYS_MS.length - 1
              ],
          },
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(
          `UpdateStatus job ${job.id} completed for invoice ${job.data.invoiceId}`,
        );
      });

      // Only fires once a job has exhausted all configured attempts (BullMQ
      // retries a job in-place without emitting 'failed' until then), so
      // this is genuinely the final-failure handler.
      this.worker.on('failed', (job, err) => {
        if (!job) return;
        this.logger.error(
          `UpdateStatus job ${job.id} failed permanently for invoice ${job.data.invoiceId} (IRN ${job.data.irn}) after ${job.attemptsMade} attempts: ${err.message}`,
        );
        this.recordOutcome(job.data.invoiceId, false).catch((e) =>
          this.logger.warn(
            `Failed to record NRS status-update failure for invoice ${job.data.invoiceId}: ${e.message}`,
          ),
        );
        this.notifyTenant(job.data).catch((e) =>
          this.logger.warn(
            `Failed to notify tenant of NRS status-update failure for invoice ${job.data.invoiceId}: ${e.message}`,
          ),
        );
      });

      this.worker.on('error', (err) => {
        this.logger.error(`Worker error: ${err.message}`);
      });

      this.logger.log('UpdateStatus worker started');
    } catch (err: any) {
      this.logger.warn(
        `UpdateStatus worker could not start (Redis may not be available): ${err.message}`,
      );
    }
  }

  private async recordOutcome(
    invoiceId: string,
    success: boolean,
  ): Promise<void> {
    await this.prisma.asAdmin((tx) =>
      tx.invoice.update({
        where: { id: invoiceId },
        data: {
          lastNrsStatusUpdateAt: new Date(),
          lastNrsStatusUpdateSuccess: success,
        },
      }),
    );
  }

  private async notifyTenant(data: UpdateStatusJobData): Promise<void> {
    const ownerRole = await this.prisma.asAdmin((tx) =>
      tx.userRole.findFirst({
        where: { tenantId: data.tenantId, role: 'OWNER' },
        include: { user: { select: { id: true, isActive: true } } },
      }),
    );

    if (!ownerRole?.user?.isActive) return;

    await this.notificationService.create({
      tenantId: data.tenantId,
      userId: ownerRole.user.id,
      type: 'nrs_status_update_failed',
      title: 'Payment status could not be reported to NRS',
      body: `We couldn't confirm the ${data.status.toLowerCase()} payment status for invoice IRN ${data.irn} with NRS after 3 attempts. This does not affect the payment record — only the FIRS-side status.`,
      link: `/invoices/${data.invoiceId}`,
    });
  }

  private async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('UpdateStatus worker stopped');
    }
  }
}
