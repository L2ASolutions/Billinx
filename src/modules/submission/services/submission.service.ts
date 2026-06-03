import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ActivityService } from '../../activity/services/activity.service';
import { MockAdapter } from '../adapters/mock/mock.adapter';
import { InterswitchAdapter } from '../adapters/interswitch/interswitch.adapter';
import { AppAdapter } from '../adapters/app-adapter.interface';
import { addToSubmissionQueue } from '../queues/submission.queue';
import {
  SubmissionRequest,
  SubmissionResult,
  AppAdapterKey,
  QueueJobData,
} from '../../../../packages/types/submission';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);
  private readonly adapters: Map<string, AppAdapter> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly mockAdapter: MockAdapter,
    private readonly interswitchAdapter: InterswitchAdapter,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.adapters.set('mock', mockAdapter);
    this.adapters.set('interswitch', interswitchAdapter);
  }

  async queueInvoice(
    invoiceId: string,
    tenantId: string,
    platformIrn: string,
    adapterKey: AppAdapterKey,
  ): Promise<void> {
    const jobData: QueueJobData = {
      invoiceId,
      tenantId,
      platformIrn,
      adapterKey,
      attempt: 1,
    };

    await this.prisma.asAdmin(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'QUEUED' },
      });
      await tx.invoiceStateHistory.create({
        data: {
          invoiceId,
          tenantId,
          fromStatus: 'DRAFT',
          toStatus: 'QUEUED',
          actor: 'system:submission-service',
          reason: 'Invoice queued for FIRS submission',
        } as any,
      });
    });

    await addToSubmissionQueue(jobData);
    this.logger.log(
      `Invoice ${platformIrn} queued for submission via ${adapterKey}`,
    );
  }

  async processSubmission(jobData: QueueJobData): Promise<void> {
    const { invoiceId, tenantId, platformIrn, adapterKey, attempt } = jobData;

    this.logger.log(
      `Processing submission: ${platformIrn} via ${adapterKey} (attempt ${attempt})`,
    );

    const adapter = this.adapters.get(adapterKey);
    if (!adapter) throw new Error(`No adapter found for key: ${adapterKey}`);

    const invoice = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findUnique({ where: { id: invoiceId } });
    });
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    await this.prisma.asAdmin(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'SUBMITTING' },
      });
      await tx.invoiceStateHistory.create({
        data: {
          invoiceId,
          tenantId,
          fromStatus: 'QUEUED',
          toStatus: 'SUBMITTING',
          actor: 'system:submission-worker',
          reason: 'Submitting to FIRS',
        } as any,
      });
    });

    const submissionAttempt = await this.prisma.asAdmin(async (tx) => {
      return tx.submissionAttempt.create({
        data: {
          invoiceId,
          tenantId,
          adapterKey,
          attemptNumber: attempt,
          requestPayload: { invoiceId, platformIrn, adapterKey },
        },
      });
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_SUBMITTED',
      actor: 'system:submission-worker',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { invoiceId, platformIrn, adapterKey, attempt },
    });

    const request: SubmissionRequest = {
      invoiceId,
      tenantId,
      platformIrn,
      adapterKey,
      payload: { invoice },
      attempt,
    };

    let result: SubmissionResult;
    try {
      result = await adapter.submit(request);
    } catch (err: any) {
      result = {
        success: false,
        errorCode: 'ADAPTER_ERROR',
        errorMessage: err.message,
        retryable: true,
      };
    }

    // IRN duplicate recovery: check FIRS for real status instead of dead-lettering immediately
    if (!result.success && result.errorCode === 'IRN_DUPLICATE') {
      result = await this.recoverIrnDuplicate(
        adapter,
        platformIrn,
        tenantId,
        invoiceId,
      );
    }

    if (result.success) {
      await this.handleSuccess(
        invoiceId,
        tenantId,
        submissionAttempt.id,
        result,
        platformIrn,
      );
    } else {
      await this.handleFailure(
        invoiceId,
        tenantId,
        submissionAttempt.id,
        result,
        attempt,
      );
    }
  }

  private async recoverIrnDuplicate(
    adapter: AppAdapter,
    platformIrn: string,
    tenantId: string,
    invoiceId: string,
  ): Promise<SubmissionResult> {
    this.logger.warn(
      `IRN duplicate detected for ${platformIrn} — checking FIRS for real status`,
    );
    try {
      const statusResult = await adapter.checkStatus(platformIrn, { tenantId });
      if (statusResult.success) {
        this.logger.log(
          `IRN duplicate recovered — already accepted by FIRS: ${platformIrn}`,
        );
      } else {
        this.logger.warn(
          `IRN duplicate status check: FIRS returned non-success for ${platformIrn}`,
        );
      }
      return statusResult;
    } catch (err: any) {
      this.logger.error(
        `IRN duplicate status check failed for ${platformIrn}: ${err.message}`,
      );
      this.activityService.track({
        tenantId,
        eventType: 'SYSTEM_ERROR',
        actor: 'system:submission-service',
        entityType: 'Invoice',
        entityId: invoiceId,
        payload: {
          invoiceId,
          platformIrn,
          reason: 'IRN duplicate — status check failed, manual review required',
          error: err.message,
        },
      });
      return {
        success: false,
        errorCode: 'IRN_DUPLICATE',
        errorMessage: 'IRN duplicate — manual review required',
        retryable: false,
      };
    }
  }

  private async handleSuccess(
    invoiceId: string,
    tenantId: string,
    attemptId: string,
    result: SubmissionResult,
    platformIrn: string,
  ): Promise<void> {
    await this.prisma.asAdmin(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'ACCEPTED',
          firsConfirmedIrn: result.firsConfirmedIrn ?? null,
          qrCodeBase64: result.qrCodeBase64 ?? null,
          acceptedAt: new Date(),
          submittedAt: new Date(),
        },
      });

      await tx.submissionAttempt.update({
        where: { id: attemptId },
        data: {
          succeededAt: new Date(),
          responsePayload: result.rawResponse
            ? JSON.parse(JSON.stringify(result.rawResponse))
            : null,
        } as any,
      });

      await tx.invoiceStateHistory.create({
        data: {
          invoiceId,
          tenantId,
          fromStatus: 'SUBMITTING',
          toStatus: 'ACCEPTED',
          actor: 'system:firs',
          reason: `FIRS accepted. IRN: ${platformIrn}. FIRS Reference: ${result.firsConfirmedIrn}`,
        } as any,
      });
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_ACCEPTED',
      actor: 'system:firs',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: {
        invoiceId,
        firsConfirmedIrn: result.firsConfirmedIrn,
        csid: result.csid,
      },
    });

    this.eventEmitter.emit('invoice.accepted', {
      tenantId,
      eventType: 'invoice.accepted',
      invoiceId,
      platformIrn: result.firsConfirmedIrn ?? invoiceId,
      data: {
        invoiceId,
        firsConfirmedIrn: result.firsConfirmedIrn,
        csid: result.csid,
        qrCodeBase64: result.qrCodeBase64,
      },
    });

    this.logger.log(
      `Invoice ${invoiceId} accepted by FIRS. IRN: ${result.firsConfirmedIrn}`,
    );
  }

  private async handleFailure(
    invoiceId: string,
    tenantId: string,
    attemptId: string,
    result: SubmissionResult,
    attempt: number,
  ): Promise<void> {
    const maxAttempts = 3;
    const isFinal = !result.retryable || attempt >= maxAttempts;
    const newStatus = isFinal ? 'DEAD_LETTERED' : 'SUBMISSION_FAILED';

    await this.prisma.asAdmin(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: newStatus,
        },
      });

      await tx.submissionAttempt.update({
        where: { id: attemptId },
        data: {
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
          failedAt: new Date(),
        } as any,
      });

      await tx.invoiceStateHistory.create({
        data: {
          invoiceId,
          tenantId,
          fromStatus: 'SUBMITTING',
          toStatus: newStatus,
          actor: 'system:firs',
          reason: result.errorMessage ?? 'Submission failed',
        } as any,
      });
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_REJECTED',
      actor: 'system:firs',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: {
        invoiceId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        attempt,
        isFinal,
      },
    });

    if (isFinal) {
      this.eventEmitter.emit('invoice.rejected', {
        tenantId,
        eventType: 'invoice.rejected',
        invoiceId,
        platformIrn: invoiceId,
        data: {
          invoiceId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        },
      });
    }

    this.logger.warn(
      `Invoice ${invoiceId} ${isFinal ? 'rejected' : 'failed (will retry)'}. Error: ${result.errorMessage}`,
    );
  }

  async getAdapterHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    for (const [key, adapter] of this.adapters) {
      try {
        health[key] = await adapter.ping();
      } catch {
        health[key] = false;
      }
    }
    return health;
  }
}
