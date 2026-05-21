import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ActivityService } from '../../activity/services/activity.service';
import { InterswitchAdapter } from '../../submission/adapters/interswitch/interswitch.adapter';

const VALID_PROVIDERS = [
  'MANUAL',
  'PAYSTACK',
  'FLUTTERWAVE',
  'BANK_TRANSFER',
] as const;
type PaymentProvider = (typeof VALID_PROVIDERS)[number];

export interface RecordPaymentRequest {
  amount: number;
  reference: string;
  provider: string;
  paidAt: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activityService: ActivityService,
    private readonly interswitchAdapter: InterswitchAdapter,
  ) {}

  async recordPayment(
    invoiceId: string,
    tenantId: string,
    actor: string,
    body: RecordPaymentRequest,
  ) {
    if (!VALID_PROVIDERS.includes(body.provider as PaymentProvider)) {
      throw new BadRequestException(
        `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
      );
    }

    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException('amount must be a positive number');
    }

    if (!body.reference?.trim()) {
      throw new BadRequestException('reference is required');
    }

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({ where: { id: invoiceId } }),
    );

    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status !== 'ACCEPTED') {
      throw new BadRequestException(
        'Payments can only be recorded against ACCEPTED invoices',
      );
    }

    const paidAt = new Date(body.paidAt);
    if (isNaN(paidAt.getTime())) {
      throw new BadRequestException('paidAt must be a valid ISO date string');
    }

    const payableAmount = Number(invoice.totalAmount);
    const previouslyPaid = Number(invoice.amountPaid);
    const newAmountPaid = previouslyPaid + body.amount;
    const amountOutstanding = Math.max(0, payableAmount - newAmountPaid);

    const newPaymentStatus =
      newAmountPaid >= payableAmount ? 'PAID' : 'PARTIAL';

    const [payment] = await this.prisma.asAdmin((tx) =>
      Promise.all([
        tx.paymentRecord.create({
          data: {
            invoiceId,
            tenantId,
            amount: body.amount,
            currency: invoice.currency ?? 'NGN',
            paymentReference: body.reference,
            provider: body.provider,
            paidAt,
            notes: body.notes ?? null,
            metadata: body.metadata ? (body.metadata as any) : undefined,
          },
        }),
        tx.invoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: newAmountPaid,
            paymentStatus: newPaymentStatus,
          },
        }),
      ]),
    );

    const eventData = {
      tenantId,
      eventType:
        newPaymentStatus === 'PAID' ? 'payment.confirmed' : 'payment.partial',
      invoiceId,
      platformIrn: invoice.platformIrn,
      data: {
        invoiceId,
        platformIrn: invoice.platformIrn,
        paymentId: payment.id,
        amount: body.amount,
        currency: payment.currency,
        provider: body.provider,
        reference: body.reference,
        paidAt: paidAt.toISOString(),
        amountPaid: newAmountPaid,
        amountOutstanding,
        paymentStatus: newPaymentStatus,
      },
    };

    this.eventEmitter.emit(eventData.eventType, eventData);

    if (newPaymentStatus === 'PAID' && invoice.firsConfirmedIrn) {
      this.interswitchAdapter
        .updatePaymentStatus(invoice.firsConfirmedIrn, tenantId, 'PAID')
        .catch((err) =>
          this.logger.warn(
            `updatePaymentStatus fire-and-forget failed for invoice ${invoiceId}: ${err.message}`,
          ),
        );
    }

    this.activityService.track({
      tenantId,
      eventType: 'PAYMENT_RECORDED',
      actor,
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: {
        paymentId: payment.id,
        amount: body.amount,
        provider: body.provider,
        reference: body.reference,
        paymentStatus: newPaymentStatus,
      },
    });

    return {
      payment: this.mapPayment(payment),
      amountPaid: newAmountPaid,
      amountOutstanding,
      paymentStatus: newPaymentStatus,
    };
  }

  async listPayments(invoiceId: string, tenantId: string) {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          tenantId: true,
          totalAmount: true,
          amountPaid: true,
          paymentStatus: true,
        },
      }),
    );

    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    const records = await this.prisma.asAdmin((tx) =>
      tx.paymentRecord.findMany({
        where: { invoiceId, tenantId },
        orderBy: { paidAt: 'desc' },
      }),
    );

    const amountPaid = Number(invoice.amountPaid);
    const amountOutstanding = Math.max(
      0,
      Number(invoice.totalAmount) - amountPaid,
    );

    return {
      data: records.map((r) => this.mapPayment(r)),
      total: records.length,
      amountPaid,
      amountOutstanding,
      paymentStatus: invoice.paymentStatus,
    };
  }

  // ─── Overdue detection — daily at 6am UTC ────────────────────────────────

  @Cron('0 6 * * *')
  async detectOverdueInvoices() {
    this.logger.log('Running overdue invoice detection');

    const now = new Date();

    const overdueInvoices = await this.prisma.asAdmin((tx) =>
      tx.invoice.findMany({
        where: {
          status: 'ACCEPTED',
          isOverdue: false,
          paymentDueDate: { lt: now },
          paymentStatus: { not: 'PAID' },
        },
        select: {
          id: true,
          tenantId: true,
          platformIrn: true,
          buyerName: true,
          totalAmount: true,
          amountPaid: true,
          paymentDueDate: true,
          currency: true,
        },
      }),
    );

    if (overdueInvoices.length === 0) {
      this.logger.log('No newly overdue invoices found');
      return;
    }

    this.logger.log(`Marking ${overdueInvoices.length} invoice(s) as overdue`);

    await this.prisma.asAdmin((tx) =>
      tx.invoice.updateMany({
        where: { id: { in: overdueInvoices.map((inv) => inv.id) } },
        data: { isOverdue: true, overdueAt: now },
      }),
    );

    for (const inv of overdueInvoices) {
      const amountOutstanding = Math.max(
        0,
        Number(inv.totalAmount) - Number(inv.amountPaid),
      );

      this.eventEmitter.emit('invoice.overdue', {
        tenantId: inv.tenantId,
        eventType: 'invoice.overdue',
        invoiceId: inv.id,
        platformIrn: inv.platformIrn,
        data: {
          invoiceId: inv.id,
          platformIrn: inv.platformIrn,
          buyerName: inv.buyerName,
          currency: inv.currency,
          amountOutstanding,
          paymentDueDate: inv.paymentDueDate?.toISOString(),
          overdueAt: now.toISOString(),
        },
      });

      this.activityService.track({
        tenantId: inv.tenantId,
        eventType: 'INVOICE_OVERDUE',
        actor: 'system',
        entityType: 'Invoice',
        entityId: inv.id,
        payload: { platformIrn: inv.platformIrn, amountOutstanding },
      });
    }
  }

  private mapPayment(p: any) {
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      tenantId: p.tenantId,
      amount: Number(p.amount),
      currency: p.currency,
      paymentReference: p.paymentReference,
      provider: p.provider,
      paidAt: p.paidAt instanceof Date ? p.paidAt.toISOString() : p.paidAt,
      confirmedAt:
        p.confirmedAt instanceof Date
          ? p.confirmedAt.toISOString()
          : (p.confirmedAt ?? null),
      confirmedBy: p.confirmedBy ?? null,
      notes: p.notes ?? null,
      metadata: p.metadata ?? null,
      createdAt:
        p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    };
  }
}
