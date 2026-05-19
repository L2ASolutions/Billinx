import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../../modules/activity/services/activity.service';
import { addToSubmissionQueue } from '../../modules/submission/queues/submission.queue';

export interface RecoveryResult {
  checked: number;
  recovered: number;
  failed: number;
}

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PER_RUN = 50;

@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  onModuleInit() {
    // Run 15 s after startup so DB connections are fully established
    setTimeout(() => {
      this.reconcileStuckInvoices().catch((err) =>
        this.logger.error(`Startup reconciliation failed: ${err.message}`),
      );
    }, 15_000);
  }

  @Cron('0 */30 * * * *', { name: 'recovery-reconcile' })
  async reconcileStuckInvoices(): Promise<RecoveryResult> {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const stuck = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findMany({
        where: { status: 'SUBMITTING', updatedAt: { lt: cutoff } },
        include: {
          tenant: {
            select: { appAdapterKey: true, interswitchClientId: true },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: MAX_PER_RUN,
      });
    });

    if (stuck.length === 0) return { checked: 0, recovered: 0, failed: 0 };

    this.logger.log(
      `Recovery: found ${stuck.length} stuck SUBMITTING invoices (older than 5 min)`,
    );

    let recovered = 0;
    let failed = 0;

    for (const invoice of stuck) {
      try {
        this.logger.warn(
          `Found stuck invoice ${invoice.id} (${invoice.platformIrn}) — attempting recovery`,
        );

        const adapterKey = (invoice.tenant as any)?.interswitchClientId
          ? 'interswitch'
          : ((invoice.tenant as any)?.appAdapterKey ?? 'mock');

        await this.prisma.asAdmin(async (tx) => {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: 'QUEUED' },
          });
          await tx.invoiceStateHistory.create({
            data: {
              invoiceId: invoice.id,
              tenantId: invoice.tenantId,
              fromStatus: 'SUBMITTING',
              toStatus: 'QUEUED',
              actor: 'system:recovery',
              reason:
                'Reset by recovery service — interrupted submission detected',
            } as any,
          });
        });

        await addToSubmissionQueue({
          invoiceId: invoice.id,
          tenantId: invoice.tenantId,
          platformIrn: invoice.platformIrn,
          adapterKey: adapterKey,
          attempt: 1,
        });

        this.activityService.track({
          tenantId: invoice.tenantId,
          eventType: 'INVOICE_SUBMITTED',
          actor: 'system:recovery',
          entityType: 'Invoice',
          entityId: invoice.id,
          payload: {
            invoiceId: invoice.id,
            platformIrn: invoice.platformIrn,
            action: 'recovered-from-stuck-submitting',
            adapterKey,
          },
        });

        this.logger.log(
          `Recovered invoice ${invoice.id} (${invoice.platformIrn}) — re-queued via ${adapterKey}`,
        );
        recovered++;
      } catch (err: any) {
        this.logger.error(
          `Failed to recover invoice ${invoice.id}: ${err.message}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Recovery complete: checked=${stuck.length} recovered=${recovered} failed=${failed}`,
    );
    return { checked: stuck.length, recovered, failed };
  }
}
