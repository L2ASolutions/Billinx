import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { IrnService } from './irn.service';
import { StateMachineService } from './state-machine.service';
import { ActivityService } from '../../activity/services/activity.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  InvoiceResponse,
  InvoiceListResponse,
  InvoiceStatusResponse,
  InvoiceFilterParams,
  CancelInvoiceRequest,
  ValidationResponse,
} from '../../../../packages/types/invoice';
import { XmlInvoiceBuilder } from './xml-invoice.builder';
import { checkRole } from '../../../shared/utils/role-checker';
import { SubmissionService } from '../../submission/services/submission.service';
import { EmailService } from '../../../shared/email/email.service';
import { InventoryService } from '../../inventory/inventory.service';
import { InvoiceValidationService } from './invoice-validation.service';

export interface CreateInvoiceResult {
  invoice: InvoiceResponse;
  isDuplicate: boolean;
  message?: string;
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly irnService: IrnService,
    private readonly stateMachine: StateMachineService,
    private readonly activityService: ActivityService,
    private readonly prisma: PrismaService,
    private readonly submissionService: SubmissionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly xmlBuilder: XmlInvoiceBuilder,
    private readonly emailService: EmailService,
    private readonly validationService: InvoiceValidationService,
    @Optional() private readonly inventoryService?: InventoryService,
  ) {}

  async createInvoice(
    tenantId: string,
    environment: string,
    actor: string,
    request: any,
  ): Promise<CreateInvoiceResult> {
    // ── Source-reference duplicate check ──────────────────────────────────────
    if (request.sourceReference) {
      const existing = await this.invoiceRepository.findBySourceReference(
        tenantId,
        request.sourceReference,
      );
      if (existing) {
        const allowResubmit =
          existing.status === 'REJECTED' || existing.status === 'DEAD_LETTERED';
        if (!allowResubmit) {
          const message =
            existing.status === 'ACCEPTED'
              ? 'Invoice already accepted by FIRS'
              : 'Invoice already processing';
          this.logger.log(
            `Duplicate sourceReference=${request.sourceReference} tenant=${tenantId} status=${existing.status}`,
          );
          return {
            invoice: this.mapToResponse(existing),
            isDuplicate: true,
            message,
          };
        }
        this.logger.log(
          `Resubmitting rejected/dead-lettered invoice for sourceReference=${request.sourceReference}`,
        );
      }
    }

    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { tin: true, appAdapterKey: true, interswitchServiceId: true },
      });
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const platformIrn = await this.irnService.generateUniqueIrn(
      tenantId,
      request.issueDate ?? new Date().toISOString().slice(0, 10),
      tenant.interswitchServiceId ?? 'SVC00001',
    );

    this.validationService.validateInvoiceFields(
      {
        invoiceTypeCode: request.invoiceTypeCode,
        invoiceKind: request.invoiceKind,
        seller: request.seller,
        buyer: request.buyer,
        issueDate: request.issueDate,
        originalIrn: request.originalIrn,
        lineItems: request.lineItems,
        totalAmount: request.legalMonetaryTotal?.payableAmount,
        legalMonetaryTotal: request.legalMonetaryTotal,
        taxTotal: request.taxTotal,
        paymentStatus: request.paymentStatus,
      },
      'CREATE',
    );

    const invoice = await this.invoiceRepository.create({
      tenantId,
      environment,
      schemaVersion: request.schemaVersion ?? '2.0',
      invoiceTypeCode: this.mapInvoiceTypeCode(request.invoiceTypeCode),
      platformIrn,
      sourceReference: request.sourceReference ?? null,
      buyerReference: request.buyerReference ?? null,
      orderReference: request.orderReference ?? null,
      accountingCost: request.accountingCost ?? null,
      sellerTin: request.seller?.tin,
      sellerName: request.seller?.partyName,
      buyerTin: request.buyer?.tin ?? null,
      buyerName: request.buyer?.partyName,
      issueDate: new Date(request.issueDate),
      dueDate: request.dueDate ? new Date(request.dueDate) : null,
      paymentDueDate: request.dueDate ? new Date(request.dueDate) : null,
      // Persisted at creation time (not left null for the adapter to
      // compute transiently at submission) so the stored record always
      // reflects the actual tax point date used.
      taxPointDate: request.taxPointDate
        ? new Date(request.taxPointDate)
        : new Date(request.issueDate),
      actualDeliveryDate: request.actualDeliveryDate
        ? new Date(request.actualDeliveryDate)
        : null,
      currency: request.currency ?? 'NGN',
      taxCurrencyCode: request.taxCurrencyCode ?? null,
      exchangeRate: request.exchangeRate ?? null,
      exchangeRateSource: request.exchangeRateSource ?? null,
      subtotal: request.legalMonetaryTotal?.lineExtensionAmount ?? 0,
      vatAmount: (request.taxTotal ?? []).reduce(
        (sum: number, t: any) => sum + (t.taxAmount ?? 0),
        0,
      ),
      totalAmount: request.legalMonetaryTotal?.payableAmount ?? 0,
      lineItems: JSON.parse(JSON.stringify(request.lineItems ?? [])),
      taxTotal: JSON.parse(JSON.stringify(request.taxTotal ?? [])),
      legalMonetaryTotal: JSON.parse(
        JSON.stringify(request.legalMonetaryTotal ?? {}),
      ),
      paymentMeans: request.paymentMeans
        ? JSON.parse(JSON.stringify(request.paymentMeans))
        : null,
      allowanceCharges: request.allowanceCharges
        ? JSON.parse(JSON.stringify(request.allowanceCharges))
        : null,
      billingReference: request.billingReference
        ? JSON.parse(JSON.stringify(request.billingReference))
        : null,
      documentReferences: request.dispatchDocumentReference
        ? JSON.parse(
            JSON.stringify({
              dispatch: request.dispatchDocumentReference,
              receipt: request.receiptDocumentReference,
              originator: request.originatorDocumentReference,
              contract: request.contractDocumentReference,
              additional: request.additionalDocumentReference,
            }),
          )
        : null,
      invoiceDeliveryPeriod: request.invoiceDeliveryPeriod
        ? JSON.parse(JSON.stringify(request.invoiceDeliveryPeriod))
        : null,
      deliveryPeriodStart: request.deliveryPeriodStart
        ? new Date(request.deliveryPeriodStart)
        : null,
      deliveryPeriodEnd: request.deliveryPeriodEnd
        ? new Date(request.deliveryPeriodEnd)
        : null,
      paymentTermsNote: request.paymentTermsNote ?? null,
      note: request.note ?? null,
      metadata: JSON.parse(
        JSON.stringify({
          ...(request.metadata ?? {}),
          sellerParty: request.seller ?? null,
          buyerParty: request.buyer ?? null,
        }),
      ),
      invoiceKind: request.invoiceKind ?? null,
      // Not auto-captured here — createInvoice() only creates a DRAFT, which
      // may not be submitted for hours/days. The real submission-time value
      // is stamped in submitDraft() instead.
      issueTime: request.issueTime ?? null,
      paymentStatus: request.paymentStatus ?? 'PENDING',
      originalIrn: request.originalIrn ?? null,
      status: 'DRAFT',
      ...(request.whtApplicable
        ? (() => {
            const rate = request.whtRate ?? 5;
            const payable = request.legalMonetaryTotal?.payableAmount ?? 0;
            const whtAmt = parseFloat(((payable * rate) / 100).toFixed(2));
            return {
              whtApplicable: true,
              whtRate: rate,
              whtAmount: whtAmt,
              expectedCash: parseFloat((payable - whtAmt).toFixed(2)),
            };
          })()
        : { whtApplicable: false }),
    });

    await this.invoiceRepository.addStateHistory({
      invoiceId: invoice.id,
      tenantId,
      toStatus: 'DRAFT',
      actor,
      reason: 'Invoice created',
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actor,
      entityType: 'Invoice',
      entityId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        platformIrn,
        invoiceTypeCode: request.invoiceTypeCode,
        buyerName: request.buyer?.partyName,
        buyerTin: request.buyer?.tin,
        totalAmount: request.legalMonetaryTotal?.payableAmount,
        currency: request.currency,
        lineItemCount: (request.lineItems ?? []).length,
      },
    });

    this.eventEmitter.emit('invoice.created', {
      tenantId,
      eventType: 'invoice.created',
      invoiceId: invoice.id,
      platformIrn,
      data: {
        invoiceId: invoice.id,
        platformIrn,
        invoiceTypeCode: request.invoiceTypeCode,
        sellerTin: request.seller?.tin,
        buyerTin: request.buyer?.tin,
        totalAmount: request.legalMonetaryTotal?.payableAmount,
        currency: request.currency ?? 'NGN',
      },
    });

    this.logger.log(`Invoice created: ${platformIrn} for tenant ${tenantId}`);
    // Queue invoice for FIRS submission
    const tenantData = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { appAdapterKey: true, interswitchClientId: true },
      });
    });

    const adapterKey = tenantData?.interswitchClientId
      ? 'interswitch'
      : (tenantData?.appAdapterKey ?? 'mock');

    this.submissionService
      .queueInvoice(invoice.id, tenantId, platformIrn, adapterKey as any)
      .catch((err) =>
        this.logger.error(`Failed to queue invoice: ${err.message}`),
      );
    return { invoice: this.mapToResponse(invoice), isDuplicate: false };
  }

  // ── Submit an existing DRAFT invoice ─────────────────────────────────────────
  // Updates the draft's fields with the latest form data, then queues it for
  // FIRS submission. This avoids creating a duplicate when resuming a draft.
  async submitDraft(
    invoiceId: string,
    tenantId: string,
    actor: string,
    request: any,
  ): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.tenantId !== tenantId) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        `Invoice cannot be submitted: current status is ${invoice.status}`,
      );
    }

    // Validate FIRS mandatory fields using the effective (post-merge) values
    // so a draft with incomplete data cannot be queued for submission.
    const effectiveSellerTin = request.seller?.tin ?? invoice.sellerTin;
    const effectiveSellerName = request.seller?.partyName ?? invoice.sellerName;
    const effectiveBuyerName = request.buyer?.partyName ?? invoice.buyerName;
    const effectiveIssueDate = request.issueDate ?? invoice.issueDate;
    const effectiveKind = request.invoiceKind ?? (invoice as any).invoiceKind;
    const effectiveBuyerTin = request.buyer?.tin ?? (invoice as any).buyerTin;
    const effectiveLineItems: any[] =
      request.lineItems ?? (invoice.lineItems as any[]) ?? [];
    const effectiveTotal =
      request.legalMonetaryTotal?.payableAmount ?? Number(invoice.totalAmount);
    const effectiveLegalMonetaryTotal =
      request.legalMonetaryTotal ?? (invoice.legalMonetaryTotal as any);
    const effectiveTaxTotal = request.taxTotal ?? (invoice.taxTotal as any[]);
    const effectivePaymentStatus =
      request.paymentStatus ?? (invoice as any).paymentStatus;

    this.validationService.validateInvoiceFields(
      {
        invoiceTypeCode:
          request.invoiceTypeCode ?? (invoice as any).invoiceTypeCode,
        invoiceKind: effectiveKind,
        seller: { tin: effectiveSellerTin, partyName: effectiveSellerName },
        buyer: { tin: effectiveBuyerTin, partyName: effectiveBuyerName },
        issueDate: effectiveIssueDate,
        originalIrn: request.originalIrn ?? (invoice as any).originalIrn,
        lineItems: effectiveLineItems,
        totalAmount: effectiveTotal,
        legalMonetaryTotal: effectiveLegalMonetaryTotal,
        taxTotal: effectiveTaxTotal,
        paymentStatus: effectivePaymentStatus,
      },
      'SUBMIT',
    );

    // Apply any field updates the user made before submitting.
    await this.prisma.asAdmin(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          sellerTin: request.seller?.tin ?? invoice.sellerTin,
          sellerName: request.seller?.partyName ?? invoice.sellerName,
          buyerTin: request.buyer?.tin ?? (invoice as any).buyerTin,
          buyerName: request.buyer?.partyName ?? invoice.buyerName,
          issueDate: request.issueDate
            ? new Date(request.issueDate)
            : invoice.issueDate,
          dueDate: request.dueDate
            ? new Date(request.dueDate)
            : (invoice as any).dueDate,
          paymentDueDate: request.dueDate
            ? new Date(request.dueDate)
            : (invoice as any).paymentDueDate,
          currency: request.currency ?? invoice.currency,
          invoiceKind: request.invoiceKind ?? (invoice as any).invoiceKind,
          // Always re-stamped here — this is the moment the draft actually
          // gets queued for NRS submission, not whenever the draft was
          // originally created (which may have been hours/days earlier).
          issueTime: request.issueTime ?? this.captureCurrentTime(),
          subtotal:
            request.legalMonetaryTotal?.lineExtensionAmount ?? invoice.subtotal,
          vatAmount: request.taxTotal?.length
            ? (request.taxTotal as any[]).reduce(
                (s: number, t: any) => s + (t.taxAmount ?? 0),
                0,
              )
            : invoice.vatAmount,
          totalAmount:
            request.legalMonetaryTotal?.payableAmount ?? invoice.totalAmount,
          lineItems: request.lineItems
            ? JSON.parse(JSON.stringify(request.lineItems))
            : invoice.lineItems,
          taxTotal: request.taxTotal
            ? JSON.parse(JSON.stringify(request.taxTotal))
            : invoice.taxTotal,
          legalMonetaryTotal: request.legalMonetaryTotal
            ? JSON.parse(JSON.stringify(request.legalMonetaryTotal))
            : invoice.legalMonetaryTotal,
          originalIrn: request.originalIrn ?? (invoice as any).originalIrn,
          sourceReference:
            request.sourceReference ?? (invoice as any).sourceReference,
          metadata: JSON.parse(
            JSON.stringify({
              ...((invoice as any).metadata ?? {}),
              sellerParty: request.seller ?? null,
              buyerParty: request.buyer ?? null,
            }),
          ),
        },
      });
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actor,
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: {
        invoiceId,
        platformIrn: invoice.platformIrn,
        action: 'draft_submitted',
      },
    });

    const tenantData = await this.prisma.asAdmin(async (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { appAdapterKey: true, interswitchClientId: true },
      }),
    );

    const adapterKey = tenantData?.interswitchClientId
      ? 'interswitch'
      : (tenantData?.appAdapterKey ?? 'mock');

    this.submissionService
      .queueInvoice(invoiceId, tenantId, invoice.platformIrn, adapterKey as any)
      .catch((err) =>
        this.logger.error(`Failed to queue draft invoice: ${err.message}`),
      );

    const updated = await this.invoiceRepository.findById(invoiceId);
    return this.mapToResponse(updated!);
  }

  async validateInvoice(request: any): Promise<ValidationResponse> {
    return this.validationService.validateInvoiceFields(
      {
        invoiceTypeCode: request.invoiceTypeCode,
        invoiceKind: request.invoiceKind,
        seller: request.seller,
        buyer: request.buyer,
        issueDate: request.issueDate,
        originalIrn: request.originalIrn,
        lineItems: request.lineItems,
        totalAmount: request.legalMonetaryTotal?.payableAmount,
        legalMonetaryTotal: request.legalMonetaryTotal,
        taxTotal: request.taxTotal,
        paymentStatus: request.paymentStatus,
      },
      'VALIDATE',
    );
  }

  async getInvoice(id: string, tenantId: string): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return this.mapToResponse(invoice);
  }

  async getInvoiceStatus(
    id: string,
    tenantId: string,
  ): Promise<InvoiceStatusResponse> {
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return {
      id: invoice.id,
      platformIrn: invoice.platformIrn,
      firsConfirmedIrn: invoice.firsConfirmedIrn ?? undefined,
      status: invoice.status,
      qrCodeBase64: invoice.qrCodeBase64 ?? undefined,
      history: (invoice.stateHistory ?? []).map((h: any) => ({
        fromStatus: h.fromStatus ?? undefined,
        toStatus: h.toStatus,
        actor: h.actor,
        reason: h.reason ?? undefined,
        occurredAt: h.createdAt.toISOString(),
      })),
    };
  }

  async listInvoices(
    tenantId: string,
    filters: InvoiceFilterParams,
  ): Promise<InvoiceListResponse> {
    const result = await this.invoiceRepository.findByTenant(tenantId, filters);
    return {
      data: result.data.map((i: any) => this.mapToResponse(i)),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  async cancelInvoice(
    id: string,
    tenantId: string,
    actor: string,
    request: CancelInvoiceRequest,
    actorRoles: string[] = [],
  ): Promise<InvoiceResponse> {
    checkRole(actorRoles, 'ADMIN');
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (invoice.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Only accepted invoices can be cancelled. Current status: ${invoice.status}`,
      );
    }

    this.stateMachine.assertValidTransition(
      invoice.status,
      'CANCELLATION_REQUESTED',
    );

    const updated = await this.invoiceRepository.updateStatus(
      id,
      'CANCELLATION_REQUESTED',
      { cancelledAt: new Date() },
    );

    await this.invoiceRepository.addStateHistory({
      invoiceId: id,
      tenantId,
      fromStatus: invoice.status,
      toStatus: 'CANCELLATION_REQUESTED',
      actor,
      reason: request.reason,
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CANCELLED',
      actor,
      entityType: 'Invoice',
      entityId: id,
      payload: {
        invoiceId: id,
        platformIrn: invoice.platformIrn,
        reason: request.reason,
      },
    });

    this.eventEmitter.emit('invoice.cancelled', {
      tenantId,
      eventType: 'invoice.cancelled',
      invoiceId: id,
      platformIrn: invoice.platformIrn,
      data: {
        invoiceId: id,
        platformIrn: invoice.platformIrn,
        reason: request.reason,
      },
    });

    return this.mapToResponse(updated);
  }

  async getInvoiceStats(tenantId: string) {
    const [total, accepted, rejected, draft] =
      await this.invoiceRepository.countByTenant(tenantId);
    return { total, accepted, rejected, draft };
  }

  private static readonly VISIBILITY_DEFAULTS: Record<
    string,
    Record<string, boolean>
  > = {
    VIEWER: {
      receivables: false,
      vat_strip: false,
      revenue_chart: false,
      pipeline_chart: true,
      activity_chart: true,
      needs_attention: true,
    },
    ACCOUNTANT: {
      receivables: true,
      vat_strip: true,
      revenue_chart: true,
      pipeline_chart: true,
      activity_chart: true,
      needs_attention: true,
    },
  };

  async getDashboardStats(tenantId: string, userId?: string) {
    const PENDING_STATUSES = [
      'QUEUED',
      'SUBMITTING',
      'VALIDATING',
      'VALIDATION_FAILED',
      'SUBMISSION_FAILED',
    ] as const;

    // Run all queries inside a single asAdmin() transaction with sequential
    // awaits. Concurrent $transaction calls (via Promise.all) each hold ~200 MB
    // in Prisma's query engine, causing a ~1.2 GB heap spike per request.
    // Promise.all *inside* a single $transaction is also unsafe (concurrent
    // ops confuse the interactive-transaction state machine). Sequential awaits
    // inside one transaction is both safe and memory-efficient.
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      total,
      accepted,
      rejected,
      rejectedAll,
      pending,
      firsAwaiting,
      draft,
      overdue,
      amountAgg,
      recentInvoices,
      outstandingAgg,
      overdueCount,
      collectedThisMonth,
      outputVatAgg,
      inputVatAgg,
      whtExpectedAgg,
      whtCreditsAgg,
      pendingWhtCount,
      recentPayments,
      stuckCount,
      recentRejectedInvoices,
      incomingTotal,
      incomingToReview,
      incomingApproved,
      incomingPaid,
      tenantRow,
      userRoles,
    ] = await this.prisma.asAdmin(async (tx) => {
      const total = await tx.invoice.count({ where: { tenantId } });
      const accepted = await tx.invoice.count({
        where: { tenantId, status: 'ACCEPTED' },
      });
      const rejected = await tx.invoice.count({
        where: { tenantId, status: 'REJECTED' },
      });
      const rejectedAll = await tx.invoice.count({
        where: {
          tenantId,
          status: {
            in: [
              'REJECTED',
              'SUBMISSION_FAILED',
              'DEAD_LETTERED',
              'VALIDATION_FAILED',
            ] as any,
          },
        },
      });
      const pending = await tx.invoice.count({
        where: { tenantId, status: { in: PENDING_STATUSES as any } },
      });
      const firsAwaiting = await tx.invoice.count({
        where: { tenantId, status: { in: ['QUEUED', 'SUBMITTING'] as any } },
      });
      const draft = await tx.invoice.count({
        where: { tenantId, status: 'DRAFT' },
      });
      const overdue = await tx.invoice.count({
        where: { tenantId, isOverdue: true },
      });
      const amountAgg = await tx.invoice.aggregate({
        where: { tenantId },
        _sum: { totalAmount: true },
      });
      const recentInvoices = await tx.invoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          platformIrn: true,
          buyerName: true,
          totalAmount: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      });
      // paymentStatus is NOT NULL (defaults to PENDING), so `{ not: 'PAID' }`
      // alone already covers every unpaid invoice.
      const unpaidWhere = {
        tenantId,
        status: 'ACCEPTED' as const,
        paymentStatus: { not: 'PAID' as const },
      };
      const outstandingAgg = await tx.invoice.aggregate({
        where: unpaidWhere,
        _sum: { totalAmount: true },
        _count: { id: true },
      });
      const overdueCount = await tx.invoice.count({
        where: { ...unpaidWhere, isOverdue: true },
      });
      const collectedThisMonth = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
      });
      const outputVatAgg = await tx.invoice.aggregate({
        where: unpaidWhere,
        _sum: { vatAmount: true },
      });
      const inputVatAgg = await (tx as any).incomingInvoice.aggregate({
        where: { tenantId, status: { in: ['VALIDATED', 'APPROVED'] } },
        _sum: { vatAmount: true },
      });
      const whtExpectedAgg = await tx.invoice.aggregate({
        where: {
          tenantId,
          status: 'ACCEPTED',
          whtApplicable: true,
          paymentStatus: { not: 'PAID' },
        } as any,
        _sum: { whtAmount: true } as any,
      });
      const whtCreditsAgg = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, whtDeducted: { gt: 0 } },
        _sum: { whtDeducted: true },
      });
      const pendingWhtCount = await tx.invoice.count({
        where: {
          tenantId,
          whtApplicable: true,
          paymentStatus: 'PAID',
        } as any,
      });
      const recentPayments = await (tx as any).paymentRecord.findMany({
        where: { tenantId },
        orderBy: { paidAt: 'desc' },
        take: 2,
        include: { invoice: { select: { buyerName: true } } },
      });
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const stuckCount = await tx.invoice.count({
        where: {
          tenantId,
          status: { in: ['QUEUED', 'SUBMITTING'] as any },
          updatedAt: { lt: fiveMinutesAgo },
        },
      });
      const recentRejectedInvoices = await tx.invoice.findMany({
        where: { tenantId, status: 'REJECTED' },
        orderBy: { rejectedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          platformIrn: true,
          buyerName: true,
          rejectedAt: true,
          stateHistory: {
            where: { toStatus: 'REJECTED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { reason: true },
          },
        },
      });
      const incomingTotal = await (tx as any).incomingInvoice.count({
        where: { tenantId },
      });
      const incomingToReview = await (tx as any).incomingInvoice.count({
        where: { tenantId, status: 'RECEIVED' },
      });
      const incomingApproved = await (tx as any).incomingInvoice.count({
        where: { tenantId, status: 'APPROVED' },
      });
      const incomingPaid = await (tx as any).incomingInvoice.count({
        where: { tenantId, status: 'PAID' },
      });
      const tenantRow = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { dashboardVisibility: true },
      });
      const userRoles = userId
        ? await tx.userRole.findMany({
            where: { userId, tenantId },
            select: { role: true },
          })
        : [];
      return [
        total,
        accepted,
        rejected,
        rejectedAll,
        pending,
        firsAwaiting,
        draft,
        overdue,
        amountAgg,
        recentInvoices,
        outstandingAgg,
        overdueCount,
        collectedThisMonth,
        outputVatAgg,
        inputVatAgg,
        whtExpectedAgg,
        whtCreditsAgg,
        pendingWhtCount,
        recentPayments,
        stuckCount,
        recentRejectedInvoices,
        incomingTotal,
        incomingToReview,
        incomingApproved,
        incomingPaid,
        tenantRow,
        userRoles,
      ] as const;
    });

    const outputVatOutstanding = Number(outputVatAgg._sum.vatAmount ?? 0);
    const inputVatOutstanding = Number(inputVatAgg._sum.vatAmount ?? 0);
    const totalWhtExpected = Number(
      (whtExpectedAgg._sum as any).whtAmount ?? 0,
    );
    const outstandingAmount = Number(outstandingAgg._sum.totalAmount ?? 0);
    const availableWhtCredits = Number(whtCreditsAgg._sum.whtDeducted ?? 0);
    const submissionAcceptanceRate =
      total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0;
    const lowStockCount = this.inventoryService
      ? await this.inventoryService.getLowStockCount(tenantId)
      : 0;

    const actorRole = (userRoles[0]?.role as string | undefined) ?? 'VIEWER';
    const myVisibility = (() => {
      if (['OWNER', 'ADMIN'].includes(actorRole)) {
        return {
          receivables: true,
          vat_strip: true,
          revenue_chart: true,
          pipeline_chart: true,
          activity_chart: true,
          needs_attention: true,
        };
      }
      const stored =
        (
          (tenantRow?.dashboardVisibility ?? {}) as Record<
            string,
            Record<string, boolean>
          >
        )[actorRole] ?? {};
      const defaults =
        InvoiceService.VISIBILITY_DEFAULTS[actorRole] ??
        InvoiceService.VISIBILITY_DEFAULTS['VIEWER'];
      return { ...defaults, ...stored };
    })();

    return {
      total,
      accepted,
      rejected,
      rejectedAll,
      pending,
      firsAwaiting,
      draft,
      overdue,
      outgoingTotal: total,
      outgoingAccepted: accepted,
      outgoingPending: pending,
      outgoingRejected: rejectedAll,
      totalAmount: Number(amountAgg._sum.totalAmount ?? 0),
      outstandingAmount,
      overdueCount,
      collectedThisMonth: Number(collectedThisMonth._sum.amount ?? 0),
      outstandingInvoiceCount: outstandingAgg._count.id,
      outputVatOutstanding,
      inputVatOutstanding,
      netVatExposure: outputVatOutstanding - inputVatOutstanding,
      totalWhtExpected,
      expectedCashCollections: outstandingAmount - totalWhtExpected,
      availableWhtCredits,
      pendingWhtCertificates: pendingWhtCount,
      submissionAcceptanceRate,
      lowStockCount,
      rejectedCount: rejected,
      stuckCount,
      recentRejections: recentRejectedInvoices.map((inv: any) => ({
        invoiceNumber: inv.platformIrn,
        buyerName: inv.buyerName,
        rejectionReason: inv.stateHistory[0]?.reason ?? null,
        rejectedAt: inv.rejectedAt ? inv.rejectedAt.toISOString() : null,
      })),
      outgoingStats: {
        total,
        pending: firsAwaiting + draft,
        accepted,
        rejected: rejectedAll,
      },
      incomingStats: {
        total: incomingTotal,
        toReview: incomingToReview,
        approved: incomingApproved,
        paid: incomingPaid,
      },
      recentInvoices: recentInvoices.map((inv) => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
        createdAt: inv.createdAt.toISOString(),
      })),
      recentPayments: recentPayments.map((p: any) => ({
        buyerName: p.invoice?.buyerName ?? 'Unknown',
        amount: Number(p.amount),
        provider: p.provider,
        paidAt: p.paidAt.toISOString(),
      })),
      myVisibility,
    };
  }

  async getPaymentStats(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      const billedAgg = await tx.invoice.aggregate({
        where: { tenantId, status: 'ACCEPTED' },
        _sum: { totalAmount: true },
      });
      const collectedAgg = await (tx as any).paymentRecord.aggregate({
        where: { tenantId },
        _sum: { amount: true },
      });
      const totalBilled = Number(billedAgg._sum.totalAmount ?? 0);
      const totalCollected = Number(collectedAgg._sum.amount ?? 0);
      const totalOutstanding = Math.max(0, totalBilled - totalCollected);
      const collectionRate =
        totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

      const [paidInFull, partiallyPaid, overdue, accepted, overdueInvoices] =
        await Promise.all([
          tx.invoice.count({
            where: { tenantId, status: 'ACCEPTED', paymentStatus: 'PAID' },
          }),
          tx.invoice.count({
            where: { tenantId, status: 'ACCEPTED', paymentStatus: 'PARTIAL' },
          }),
          tx.invoice.count({
            where: { tenantId, status: 'ACCEPTED', isOverdue: true },
          }),
          tx.invoice.count({ where: { tenantId, status: 'ACCEPTED' } }),
          tx.invoice.findMany({
            where: { tenantId, status: 'ACCEPTED', isOverdue: true },
            select: { totalAmount: true, amountPaid: true },
          }),
        ]);
      const unpaidNotDue = accepted - paidInFull - partiallyPaid - overdue;
      const overdueAmount = overdueInvoices.reduce(
        (sum, inv) =>
          sum +
          Math.max(0, Number(inv.totalAmount) - Number(inv.amountPaid ?? 0)),
        0,
      );

      const providerRows = await (tx as any).paymentRecord.groupBy({
        by: ['provider'],
        where: { tenantId },
        _sum: { amount: true },
      });
      const knownProviders = [
        'BANK_TRANSFER',
        'PAYSTACK',
        'FLUTTERWAVE',
        'MANUAL',
      ];
      const providerMap: Record<string, number> = {};
      for (const row of providerRows as any[]) {
        providerMap[row.provider] = Number(row._sum.amount ?? 0);
      }
      const providerBreakdown = knownProviders.map((p) => ({
        provider: p,
        total: providerMap[p] ?? 0,
      }));

      return {
        totalBilled,
        totalCollected,
        totalOutstanding,
        collectionRate,
        paidInFull,
        partiallyPaid,
        unpaidNotDue: Math.max(0, unpaidNotDue),
        overdue,
        overdueAmount,
        providerBreakdown,
      };
    });
  }

  async getPaymentCharts(tenantId: string) {
    const now = new Date();
    const PROVIDER_LABELS: Record<string, string> = {
      BANK_TRANSFER: 'Bank Transfer',
      PAYSTACK: 'Paystack',
      FLUTTERWAVE: 'Flutterwave',
      MANUAL: 'Manual',
    };

    const collectionTrend: Array<{
      month: string;
      invoiced: number;
      collected: number;
    }> = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleString('en-NG', {
        month: 'short',
        year: 'numeric',
      });

      const [invoicedAgg, collectedAgg] = await this.prisma.asAdmin(
        async (tx) => {
          const ia = await (tx as any).invoice.aggregate({
            where: {
              tenantId,
              status: 'ACCEPTED',
              issueDate: { gte: start, lt: end },
            },
            _sum: { totalAmount: true },
          });
          const ca = await (tx as any).paymentRecord.aggregate({
            where: { tenantId, paidAt: { gte: start, lt: end } },
            _sum: { amount: true },
          });
          return [ia, ca];
        },
      );

      collectionTrend.push({
        month: label,
        invoiced: Number(invoicedAgg._sum.totalAmount ?? 0),
        collected: Number(collectedAgg._sum.amount ?? 0),
      });
    }

    const providerRows: Array<{ provider: string; _sum: { amount: any } }> =
      await this.prisma.asAdmin((tx) =>
        (tx as any).paymentRecord.groupBy({
          by: ['provider'],
          where: { tenantId },
          _sum: { amount: true },
        }),
      );

    const paymentMethods = providerRows
      .map((row) => ({
        method: PROVIDER_LABELS[row.provider] ?? row.provider,
        amount: Number(row._sum.amount ?? 0),
      }))
      .filter((m) => m.amount > 0);

    return { collectionTrend, paymentMethods };
  }

  async exportAsXml(id: string, tenantId: string): Promise<string> {
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { interswitchBusinessId: true },
      }),
    );
    return this.xmlBuilder.build(
      invoice,
      tenant?.interswitchBusinessId ?? undefined,
    );
  }

  async createInvoiceFromXml(
    tenantId: string,
    environment: string,
    actor: string,
    xml: string,
  ): Promise<CreateInvoiceResult> {
    const request = this.xmlBuilder.parse(xml);
    return this.createInvoice(tenantId, environment, actor, request);
  }

  async checkBySourceReference(
    tenantId: string,
    sourceReference: string,
  ): Promise<{
    exists: boolean;
    invoice?: Partial<InvoiceResponse>;
    message: string;
  }> {
    const existing = await this.invoiceRepository.findBySourceReference(
      tenantId,
      sourceReference,
    );
    if (!existing) {
      return {
        exists: false,
        message: 'No invoice found with this source reference',
      };
    }
    return {
      exists: true,
      invoice: {
        id: existing.id,
        platformIrn: existing.platformIrn,
        firsConfirmedIrn: existing.firsConfirmedIrn ?? undefined,
        status: existing.status,
        createdAt: existing.createdAt.toISOString(),
      },
      message: `Invoice found with status: ${existing.status}`,
    };
  }

  private mapInvoiceTypeCode(code: string): string {
    const map: Record<string, string> = {
      // Corrected FIRS codes (from reference data seed)
      '381': 'STANDARD', // Commercial Invoice
      '380': 'CREDIT_NOTE', // Credit Note
      '384': 'DEBIT_NOTE', // Debit Note
      '390': 'PROFORMA', // Proforma Invoice
      '385': 'STANDARD', // Self Billed Invoice → STANDARD
      // Legacy aliases
      '383': 'DEBIT_NOTE',
      '325': 'PROFORMA',
      // Pass-through for enum values already stored
      STANDARD: 'STANDARD',
      CREDIT_NOTE: 'CREDIT_NOTE',
      DEBIT_NOTE: 'DEBIT_NOTE',
      PROFORMA: 'PROFORMA',
    };
    return map[code] ?? 'STANDARD';
  }

  private captureCurrentTime(): string {
    return new Date().toTimeString().split(' ')[0]; // HH:mm:ss
  }

  private mapToResponse(invoice: any): InvoiceResponse {
    const typeNameMap: Record<string, string> = {
      STANDARD: 'STANDARD',
      CREDIT_NOTE: 'CREDIT_NOTE',
      DEBIT_NOTE: 'DEBIT_NOTE',
      PROFORMA: 'PROFORMA',
      // Corrected FIRS codes
      '381': 'STANDARD',
      '380': 'CREDIT_NOTE',
      '384': 'DEBIT_NOTE',
      '390': 'PROFORMA',
      '383': 'DEBIT_NOTE',
      '325': 'PROFORMA',
    };
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      platformIrn: invoice.platformIrn,
      firsConfirmedIrn: invoice.firsConfirmedIrn ?? undefined,
      sourceReference: invoice.sourceReference ?? undefined,
      invoiceTypeCode: invoice.invoiceTypeCode,
      invoiceType:
        typeNameMap[invoice.invoiceTypeCode] ?? invoice.invoiceTypeCode,
      invoiceKind: invoice.invoiceKind ?? undefined,
      status: invoice.status,
      sellerTin: invoice.sellerTin,
      sellerName: invoice.sellerName,
      buyerTin: invoice.buyerTin ?? undefined,
      buyerName: invoice.buyerName,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate?.toISOString(),
      currency: invoice.currency,
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      taxAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid ?? 0),
      paymentStatus: invoice.paymentStatus ?? undefined,
      paymentDueDate:
        invoice.paymentDueDate instanceof Date
          ? invoice.paymentDueDate.toISOString()
          : (invoice.paymentDueDate ?? undefined),
      isOverdue: invoice.isOverdue ?? false,
      lineItems: invoice.lineItems as any[],
      taxTotal: invoice.taxTotal as any[],
      legalMonetaryTotal: invoice.legalMonetaryTotal,
      paymentMeans: invoice.paymentMeans as any[],
      allowanceCharges: invoice.allowanceCharges as any[],
      billingReference: invoice.billingReference as any[],
      note: invoice.note ?? undefined,
      buyerReference: invoice.buyerReference ?? undefined,
      orderReference: invoice.orderReference ?? undefined,
      paymentTermsNote: invoice.paymentTermsNote ?? undefined,
      actualDeliveryDate: invoice.actualDeliveryDate
        ? invoice.actualDeliveryDate instanceof Date
          ? invoice.actualDeliveryDate.toISOString()
          : invoice.actualDeliveryDate
        : undefined,
      deliveryPeriodStart: invoice.deliveryPeriodStart
        ? invoice.deliveryPeriodStart instanceof Date
          ? invoice.deliveryPeriodStart.toISOString()
          : invoice.deliveryPeriodStart
        : undefined,
      deliveryPeriodEnd: invoice.deliveryPeriodEnd
        ? invoice.deliveryPeriodEnd instanceof Date
          ? invoice.deliveryPeriodEnd.toISOString()
          : invoice.deliveryPeriodEnd
        : undefined,
      seller: invoice.metadata?.sellerParty ?? undefined,
      buyer: invoice.metadata?.buyerParty ?? undefined,
      qrCodeBase64: invoice.qrCodeBase64 ?? undefined,
      lastNrsStatusUpdateAt:
        invoice.lastNrsStatusUpdateAt instanceof Date
          ? invoice.lastNrsStatusUpdateAt.toISOString()
          : (invoice.lastNrsStatusUpdateAt ?? undefined),
      lastNrsStatusUpdateSuccess:
        invoice.lastNrsStatusUpdateSuccess ?? undefined,
      stateHistory: invoice.stateHistory
        ? (invoice.stateHistory as any[]).map((h) => ({
            fromStatus: h.fromStatus ?? null,
            toStatus: h.toStatus,
            createdAt:
              h.createdAt instanceof Date
                ? h.createdAt.toISOString()
                : h.createdAt,
            reason: h.reason ?? null,
          }))
        : undefined,
      submissionAttempts: invoice.submissionAttempts
        ? (invoice.submissionAttempts as any[]).map((a) => ({
            id: a.id,
            attemptNumber: a.attemptNumber,
            status: a.status,
            createdAt:
              a.createdAt instanceof Date
                ? a.createdAt.toISOString()
                : a.createdAt,
            errorMessage: a.errorMessage ?? null,
          }))
        : undefined,
      submittedAt: invoice.submittedAt?.toISOString(),
      acceptedAt: invoice.acceptedAt?.toISOString(),
      rejectedAt: invoice.rejectedAt?.toISOString(),
      cancelledAt: invoice.cancelledAt?.toISOString(),
      whtApplicable: invoice.whtApplicable ?? false,
      whtRate: invoice.whtRate != null ? Number(invoice.whtRate) : undefined,
      whtAmount:
        invoice.whtAmount != null ? Number(invoice.whtAmount) : undefined,
      expectedCash:
        invoice.expectedCash != null ? Number(invoice.expectedCash) : undefined,
      creditNotes: invoice.creditNotes
        ? (invoice.creditNotes as any[]).map((cn) => ({
            id: cn.id,
            originalAmount: Number(cn.originalAmount),
            adjustedAmount: Number(cn.adjustedAmount),
            adjustmentReason: cn.adjustmentReason,
            customerName: cn.customerName,
            customerTin: cn.customerTin ?? undefined,
            transactionDate:
              cn.transactionDate instanceof Date
                ? cn.transactionDate.toISOString()
                : cn.transactionDate,
            createdBy: cn.createdBy,
          }))
        : undefined,
      hasCreditNote: invoice.creditNotes
        ? (invoice.creditNotes as any[]).length > 0
        : false,
      netAmount: invoice.creditNotes
        ? Math.max(
            0,
            Number(invoice.totalAmount) -
              (invoice.creditNotes as any[]).reduce(
                (sum: number, cn: any) =>
                  sum + (Number(cn.originalAmount) - Number(cn.adjustedAmount)),
                0,
              ),
          )
        : Number(invoice.totalAmount),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }

  async saveDraftInvoice(
    tenantId: string,
    environment: string,
    actor: string,
    request: Record<string, any>,
  ): Promise<InvoiceResponse> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { tin: true, interswitchServiceId: true },
      }),
    );
    const platformIrn = await this.irnService.generateUniqueIrn(
      tenantId,
      request.issueDate ?? new Date().toISOString().slice(0, 10),
      tenant?.interswitchServiceId ?? 'SVC00001',
    );

    const invoice = await this.invoiceRepository.create({
      tenantId,
      environment,
      schemaVersion: request.schemaVersion ?? '2.0',
      invoiceTypeCode: this.mapInvoiceTypeCode(
        request.invoiceTypeCode ?? '381',
      ),
      platformIrn,
      sourceReference: request.sourceReference ?? null,
      buyerReference: null,
      orderReference: null,
      accountingCost: null,
      sellerTin: request.seller?.tin ?? '',
      sellerName: request.seller?.partyName ?? '',
      buyerTin: request.buyer?.tin ?? null,
      buyerName: request.buyer?.partyName ?? '',
      issueDate: request.issueDate ? new Date(request.issueDate) : new Date(),
      dueDate: request.dueDate ? new Date(request.dueDate) : null,
      paymentDueDate: request.dueDate ? new Date(request.dueDate) : null,
      currency: request.currency ?? 'NGN',
      subtotal: request.legalMonetaryTotal?.lineExtensionAmount ?? 0,
      vatAmount: (request.taxTotal ?? []).reduce(
        (sum: number, t: any) => sum + (t.taxAmount ?? 0),
        0,
      ),
      totalAmount: request.legalMonetaryTotal?.payableAmount ?? 0,
      lineItems: JSON.parse(JSON.stringify(request.lineItems ?? [])),
      taxTotal: JSON.parse(JSON.stringify(request.taxTotal ?? [])),
      legalMonetaryTotal: JSON.parse(
        JSON.stringify(request.legalMonetaryTotal ?? {}),
      ),
      invoiceKind: request.invoiceKind ?? null,
      paymentStatus: 'PENDING',
      originalIrn: request.originalIrn ?? null,
      note: request.note ?? null,
      metadata: JSON.parse(
        JSON.stringify({
          ...(request.metadata ?? {}),
          sellerParty: request.seller ?? null,
          buyerParty: request.buyer ?? null,
        }),
      ),
      status: 'DRAFT',
    });

    await this.invoiceRepository.addStateHistory({
      invoiceId: invoice.id,
      tenantId,
      toStatus: 'DRAFT',
      actor,
      reason: 'Draft saved',
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actor,
      entityType: 'Invoice',
      entityId: invoice.id,
      payload: { invoiceId: invoice.id, platformIrn, action: 'draft_saved' },
    });

    return this.mapToResponse(invoice);
  }

  async updateDraftFields(
    id: string,
    tenantId: string,
    actor: string,
    body: Record<string, any>,
  ): Promise<InvoiceResponse> {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({ where: { id } }),
    );

    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT invoices can be updated');
    }

    const updated = await this.prisma.asAdmin((tx) =>
      tx.invoice.update({
        where: { id },
        data: {
          sellerTin: body.seller?.tin ?? invoice.sellerTin,
          sellerName: body.seller?.partyName ?? invoice.sellerName,
          buyerTin: body.buyer?.tin ?? invoice.buyerTin,
          buyerName: body.buyer?.partyName ?? invoice.buyerName,
          issueDate: body.issueDate
            ? new Date(body.issueDate)
            : invoice.issueDate,
          dueDate: body.dueDate ? new Date(body.dueDate) : invoice.dueDate,
          paymentDueDate: body.dueDate
            ? new Date(body.dueDate)
            : (invoice as any).paymentDueDate,
          currency: body.currency ?? invoice.currency,
          invoiceKind: body.invoiceKind ?? invoice.invoiceKind,
          subtotal:
            body.legalMonetaryTotal?.lineExtensionAmount ?? invoice.subtotal,
          vatAmount: body.taxTotal
            ? (body.taxTotal as any[]).reduce(
                (sum: number, t: any) => sum + (t.taxAmount ?? 0),
                0,
              )
            : invoice.vatAmount,
          totalAmount:
            body.legalMonetaryTotal?.payableAmount ?? invoice.totalAmount,
          lineItems: body.lineItems
            ? JSON.parse(JSON.stringify(body.lineItems))
            : invoice.lineItems,
          taxTotal: body.taxTotal
            ? JSON.parse(JSON.stringify(body.taxTotal))
            : invoice.taxTotal,
          legalMonetaryTotal: body.legalMonetaryTotal
            ? JSON.parse(JSON.stringify(body.legalMonetaryTotal))
            : invoice.legalMonetaryTotal,
          sourceReference:
            body.sourceReference !== undefined
              ? body.sourceReference
              : invoice.sourceReference,
          originalIrn:
            body.originalIrn !== undefined
              ? body.originalIrn
              : invoice.originalIrn,
          metadata:
            body.seller || body.buyer
              ? JSON.parse(
                  JSON.stringify({
                    ...((invoice.metadata as any) ?? {}),
                    sellerParty: body.seller ?? null,
                    buyerParty: body.buyer ?? null,
                  }),
                )
              : invoice.metadata,
        },
      }),
    );

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actor,
      entityType: 'Invoice',
      entityId: id,
      payload: { invoiceId: id, action: 'draft_updated' },
    });

    return this.mapToResponse(updated);
  }

  // ── Public payment page ──────────────────────────────────────────────────

  async getPublicInvoice(invoiceId: string) {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          platformIrn: true,
          firsConfirmedIrn: true,
          issueDate: true,
          dueDate: true,
          status: true,
          paymentStatus: true,
          currency: true,
          totalAmount: true,
          subtotal: true,
          vatAmount: true,
          amountPaid: true,
          lineItems: true,
          taxTotal: true,
          legalMonetaryTotal: true,
          qrCodeBase64: true,
          paymentLink: true,
          buyerEmail: true,
          buyerName: true,
          buyerTin: true,
          sellerName: true,
          sellerTin: true,
          metadata: true,
          tenantId: true,
          acceptedAt: true,
          whtApplicable: true,
          whtAmount: true,
        },
      }),
    );

    if (!invoice) throw new NotFoundException('Invoice not found');

    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: invoice.tenantId },
        select: {
          name: true,
          telephone: true,
          registeredAddress: true,
          bankName: true,
          bankAccount: true,
          bankAccountName: true,
        },
      }),
    );

    const meta = (invoice.metadata ?? {}) as Record<string, any>;
    const sellerParty = meta.sellerParty ?? {};
    const buyerParty = meta.buyerParty ?? {};

    const amountOutstanding = Math.max(
      0,
      Number(invoice.totalAmount) - Number(invoice.amountPaid ?? 0),
    );

    const billinxUrl = process.env.BILLINX_URL ?? 'http://localhost:3001';

    return {
      id: invoice.id,
      invoiceNumber: invoice.platformIrn,
      irn: invoice.platformIrn,
      firsReference: invoice.firsConfirmedIrn ?? null,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate ?? null,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      acceptedAt: invoice.acceptedAt ?? null,
      currency: invoice.currency,
      seller: {
        partyName: invoice.sellerName,
        tin: invoice.sellerTin,
        address: sellerParty.postalAddress ?? tenant?.registeredAddress ?? null,
        telephone: tenant?.telephone ?? null,
        bankName: tenant?.bankName ?? null,
        bankAccount: tenant?.bankAccount ?? null,
        bankAccountName: tenant?.bankAccountName ?? null,
      },
      buyer: {
        partyName: invoice.buyerName,
        tin: invoice.buyerTin ?? null,
        email: invoice.buyerEmail ?? buyerParty.email ?? null,
      },
      lineItems: invoice.lineItems,
      taxTotal: invoice.taxTotal,
      legalMonetaryTotal: {
        ...(invoice.legalMonetaryTotal as object),
        payableAmount: Number(invoice.totalAmount),
      },
      amountPaid: Number(invoice.amountPaid ?? 0),
      amountOutstanding,
      qrCode: invoice.qrCodeBase64 ?? null,
      paymentLink: invoice.paymentLink ?? `${billinxUrl}/pay/${invoice.id}`,
      whtApplicable: invoice.whtApplicable,
      whtAmount: invoice.whtAmount ? Number(invoice.whtAmount) : null,
    };
  }

  // ── Duplicate invoice ────────────────────────────────────────────────────

  async duplicateInvoice(
    tenantId: string,
    id: string,
    actor: string,
    environment: string,
  ): Promise<InvoiceResponse & { isDuplicate: boolean }> {
    const original = await this.invoiceRepository.findById(id);
    if (!original || original.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { interswitchServiceId: true },
      }),
    );

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);

    const platformIrn = await this.irnService.generateUniqueIrn(
      tenantId,
      todayStr,
      tenant?.interswitchServiceId ?? 'SVC00001',
    );

    const meta = (original.metadata as any) ?? {};
    const newInvoice = await this.invoiceRepository.create({
      tenantId,
      environment,
      schemaVersion: (original as any).schemaVersion ?? '2.0',
      invoiceTypeCode: original.invoiceTypeCode,
      invoiceKind: (original as any).invoiceKind ?? null,
      platformIrn,
      status: 'DRAFT',
      issueDate: today,
      dueDate,
      currency: original.currency,
      sellerTin: original.sellerTin,
      sellerName: original.sellerName,
      buyerTin: null,
      buyerName: '',
      subtotal: Number(original.subtotal),
      vatAmount: Number(original.vatAmount),
      totalAmount: Number(original.totalAmount),
      amountPaid: 0,
      paymentStatus: 'PENDING',
      lineItems: JSON.parse(JSON.stringify(original.lineItems ?? [])),
      taxTotal: JSON.parse(JSON.stringify(original.taxTotal ?? [])),
      legalMonetaryTotal: JSON.parse(
        JSON.stringify(original.legalMonetaryTotal ?? {}),
      ),
      allowanceCharges: original.allowanceCharges
        ? JSON.parse(JSON.stringify(original.allowanceCharges))
        : null,
      invoiceDeliveryPeriod: (original as any).invoiceDeliveryPeriod
        ? JSON.parse(JSON.stringify((original as any).invoiceDeliveryPeriod))
        : null,
      note: original.note ?? null,
      paymentTermsNote: (original as any).paymentTermsNote ?? null,
      metadata: JSON.parse(
        JSON.stringify({
          ...meta,
          sellerParty: meta.sellerParty ?? null,
          buyerParty: null,
          duplicatedFromId: original.id,
        }),
      ),
    });

    await this.invoiceRepository.addStateHistory({
      invoiceId: newInvoice.id,
      tenantId,
      toStatus: 'DRAFT',
      actor,
      reason: `Duplicated from ${original.platformIrn}`,
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actor,
      entityType: 'Invoice',
      entityId: newInvoice.id,
      payload: {
        invoiceId: newInvoice.id,
        platformIrn,
        action: 'duplicated',
        originalId: original.id,
        originalIrn: original.platformIrn,
      },
    });

    return { ...this.mapToResponse(newInvoice), isDuplicate: true };
  }

  // ── Sample invoice ────────────────────────────────────────────────────────

  // Static demo payload for docs/UI examples only — never persisted or
  // submitted to NRS, so it's exempt from the "invoice_kind must never be
  // silently defaulted" rule enforced elsewhere (InvoiceValidationService,
  // InterswitchAdapter).
  getSampleInvoice() {
    return {
      invoiceNumber: 'INV-2026-SAMPLE',
      invoiceTypeCode: '381',
      invoiceKind: 'B2B',
      currency: 'NGN',
      issueDate: '2026-06-01',
      dueDate: '2026-07-01',
      note: 'Payment due within 30 days',
      seller: {
        partyName: 'Your Company Name Ltd',
        tin: '12345678-0001',
        email: 'your@company.ng',
        telephone: '+2348012345678',
        postalAddress: {
          streetName: '10 Your Street',
          cityName: 'Lagos',
          state: 'NG-LA',
          lga: 'NG-LA-IK',
          country: 'NG',
        },
      },
      buyer: {
        partyName: 'Customer Company Ltd',
        tin: '87654321-0001',
        email: 'customer@company.ng',
        telephone: '+2348098765432',
        postalAddress: {
          streetName: '20 Customer Street',
          cityName: 'Abuja',
          state: 'NG-FC',
          country: 'NG',
        },
      },
      lineItems: [
        {
          hsnCode: '6201',
          productCategory: 'Computer programming activities',
          invoicedQuantity: 1,
          lineExtensionAmount: 500000,
          item: {
            name: 'Software Development Services',
            description: 'Monthly software development retainer',
          },
          price: {
            priceAmount: 500000,
            baseQuantity: 1,
            priceUnit: 'EA',
          },
          taxCategory: {
            id: 'STANDARD_VAT',
            percent: 7.5,
          },
        },
      ],
      taxTotal: [
        {
          taxAmount: 37500,
          taxSubtotal: [
            {
              taxableAmount: 500000,
              taxAmount: 37500,
              taxCategory: { id: 'STANDARD_VAT', percent: 7.5 },
            },
          ],
        },
      ],
      legalMonetaryTotal: {
        lineExtensionAmount: 500000,
        taxExclusiveAmount: 500000,
        taxInclusiveAmount: 537500,
        payableAmount: 537500,
      },
      irn: 'INV20260001-SVC00001-20260601',
      annotations: {
        seller_partyName: 'Your registered business name',
        seller_tin: 'Your FIRS Tax Identification Number',
        seller_email: 'Business email for correspondence',
        buyer_partyName: 'Your customer company name',
        buyer_tin: 'Customer TIN (use RC-XXXXX if no TIN)',
        lineItems_hsnCode: 'Product/service code from FIRS list',
        lineItems_taxCategory: 'STANDARD_VAT = 7.5% Nigerian VAT',
        irn: 'Auto-generated by Billinx when submitted',
        legalMonetaryTotal: 'All amounts calculated automatically',
      },
    };
  }

  // ── Send to buyer ─────────────────────────────────────────────────────────

  async sendToBuyer(invoiceId: string, tenantId: string) {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          tenantId: true,
          platformIrn: true,
          firsConfirmedIrn: true,
          status: true,
          currency: true,
          totalAmount: true,
          dueDate: true,
          buyerName: true,
          buyerEmail: true,
          sellerName: true,
          metadata: true,
        },
      }),
    );

    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== 'ACCEPTED') {
      throw new BadRequestException(
        'Invoice must be ACCEPTED before sending to buyer',
      );
    }

    const meta = (invoice.metadata ?? {}) as Record<string, any>;
    const buyerParty = meta.buyerParty ?? {};
    const buyerEmail = invoice.buyerEmail ?? buyerParty.email;

    if (!buyerEmail) {
      throw new BadRequestException(
        'No buyer email on file. Update the invoice with the buyer email.',
      );
    }

    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          bankName: true,
          bankAccount: true,
          bankAccountName: true,
        },
      }),
    );

    const billinxUrl = process.env.BILLINX_URL ?? 'http://localhost:3001';
    const paymentLink = `${billinxUrl}/pay/${invoice.id}`;
    const totalFormatted = `${invoice.currency} ${Number(invoice.totalAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    const dueDateStr = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'N/A';

    this.emailService.sendInvoiceToBuyer({
      to: buyerEmail,
      buyerName: invoice.buyerName,
      sellerName: invoice.sellerName,
      invoiceNumber: invoice.platformIrn,
      firsReference: invoice.firsConfirmedIrn ?? null,
      totalAmount: totalFormatted,
      dueDate: dueDateStr,
      paymentLink,
      bankName: tenant?.bankName ?? null,
      bankAccount: tenant?.bankAccount ?? null,
      bankAccountName: tenant?.bankAccountName ?? null,
    });

    this.activityService.track({
      tenantId,
      eventType: 'INVOICE_SENT_TO_BUYER',
      actor: 'user',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { invoiceId, buyerEmail, platformIrn: invoice.platformIrn },
    });

    return { sent: true, to: buyerEmail };
  }

  async getDashboardCharts(tenantId: string) {
    const now = new Date();
    const months = 6;

    const revenueTrend: Array<{
      month: string;
      monthKey: string;
      amount: number;
    }> = [];
    const sentVsReceived: Array<{
      month: string;
      sent: number;
      received: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleString('en-NG', {
        month: 'short',
        year: 'numeric',
      });
      const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

      const [revenueAgg, sentCount, receivedCount] = await this.prisma.asAdmin(
        async (tx) => {
          const ra = await (tx as any).invoice.aggregate({
            where: {
              tenantId,
              issueDate: { gte: start, lt: end },
              OR: [{ status: 'ACCEPTED' }, { paymentStatus: 'PAID' }],
              NOT: { status: { in: ['DRAFT', 'CANCELLED'] as any } },
            },
            _sum: { totalAmount: true },
          });
          const sc = await (tx as any).invoice.count({
            where: {
              tenantId,
              issueDate: { gte: start, lt: end },
              NOT: { status: 'CANCELLED' as any },
            },
          });
          const rc = await (tx as any).incomingInvoice.count({
            where: {
              tenantId,
              createdAt: { gte: start, lt: end },
            },
          });
          return [ra, sc, rc];
        },
      );

      revenueTrend.push({
        month: label,
        monthKey,
        amount: Number(revenueAgg._sum.totalAmount ?? 0),
      });
      sentVsReceived.push({
        month: label,
        sent: sentCount,
        received: receivedCount,
      });
    }

    const allInvoices: {
      status: string;
      paymentStatus: string;
      isOverdue: boolean;
    }[] = await this.prisma.asAdmin((tx) =>
      (tx as any).invoice.findMany({
        where: { tenantId },
        select: { status: true, paymentStatus: true, isOverdue: true },
      }),
    );

    const breakdown = {
      Paid: 0,
      Overdue: 0,
      Accepted: 0,
      'Needs attention': 0,
      Draft: 0,
      Cancelled: 0,
    };

    const NEEDS_ATTENTION = new Set([
      'REJECTED',
      'SUBMISSION_FAILED',
      'DEAD_LETTERED',
      'VALIDATION_FAILED',
    ]);

    for (const inv of allInvoices) {
      if (inv.paymentStatus === 'PAID') {
        breakdown['Paid']++;
      } else if (inv.status === 'ACCEPTED' && inv.isOverdue) {
        breakdown['Overdue']++;
      } else if (inv.status === 'ACCEPTED') {
        breakdown['Accepted']++;
      } else if (NEEDS_ATTENTION.has(inv.status)) {
        breakdown['Needs attention']++;
      } else if (inv.status === 'DRAFT') {
        breakdown['Draft']++;
      } else if (inv.status === 'CANCELLED') {
        breakdown['Cancelled']++;
      }
    }

    const invoiceStatusBreakdown = Object.entries(breakdown).map(
      ([status, count]) => ({ status, count }),
    );

    return { revenueTrend, invoiceStatusBreakdown, sentVsReceived };
  }

  async getDashboardRejections(tenantId: string) {
    const rejectedStatuses = ['REJECTED', 'SUBMISSION_FAILED', 'DEAD_LETTERED'];

    const rejectedInvoices: {
      id: string;
      submissionAttempts: {
        errorCode: string | null;
        errorMessage: string | null;
      }[];
    }[] = await this.prisma.asAdmin((tx) =>
      (tx as any).invoice.findMany({
        where: {
          tenantId,
          status: { in: rejectedStatuses as any },
        },
        select: {
          id: true,
          submissionAttempts: {
            where: { failedAt: { not: null } },
            orderBy: { failedAt: 'desc' as const },
            take: 1,
            select: { errorCode: true, errorMessage: true },
          },
        },
      }),
    );

    if (rejectedInvoices.length === 0) {
      return { totalRejected: 0, allResolved: true, reasons: [] };
    }

    const reasonMap = new Map<
      string,
      {
        errorCode: string;
        errorMessage: string;
        count: number;
        invoiceIds: string[];
      }
    >();

    for (const inv of rejectedInvoices) {
      const attempt = inv.submissionAttempts[0];
      const errorCode = attempt?.errorCode ?? 'UNKNOWN';
      const errorMessage = attempt?.errorMessage ?? 'Submission failed';

      if (!reasonMap.has(errorCode)) {
        reasonMap.set(errorCode, {
          errorCode,
          errorMessage,
          count: 0,
          invoiceIds: [],
        });
      }
      const entry = reasonMap.get(errorCode)!;
      entry.count++;
      entry.invoiceIds.push(inv.id);
    }

    const reasons = Array.from(reasonMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return {
      totalRejected: rejectedInvoices.length,
      allResolved: false,
      reasons,
    };
  }

  async sendManualReminder(
    invoiceId: string,
    tenantId: string,
    actor: string,
  ): Promise<{ message: string; sentTo: string }> {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          paymentStatus: true,
          buyerEmail: true,
          buyerName: true,
          platformIrn: true,
          firsConfirmedIrn: true,
          totalAmount: true,
          amountPaid: true,
          currency: true,
          paymentDueDate: true,
          paymentLink: true,
          lastReminderAt: true,
        },
      }),
    );

    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== 'ACCEPTED') {
      throw new BadRequestException(
        'Reminders can only be sent for FIRS-accepted invoices',
      );
    }

    if (invoice.paymentStatus === 'PAID') {
      throw new BadRequestException('This invoice has already been paid');
    }

    if (!invoice.buyerEmail) {
      throw new BadRequestException(
        'Cannot send reminder — invoice has no buyer email',
      );
    }

    if (invoice.lastReminderAt) {
      const hoursSince =
        (Date.now() - new Date(invoice.lastReminderAt).getTime()) /
        (1000 * 60 * 60);
      if (hoursSince < 24) {
        throw new HttpException(
          {
            message: 'A reminder was already sent in the last 24 hours',
            lastSentAt: invoice.lastReminderAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      }),
    );

    this.emailService.sendBuyerPaymentReminder({
      to: invoice.buyerEmail,
      buyerName: invoice.buyerName,
      invoiceNumber: invoice.firsConfirmedIrn ?? invoice.platformIrn,
      invoiceId: invoice.id,
      totalAmount: Number(invoice.totalAmount),
      amountOutstanding: Math.max(
        0,
        Number(invoice.totalAmount) - Number(invoice.amountPaid ?? 0),
      ),
      currency: invoice.currency ?? 'NGN',
      dueDate: invoice.paymentDueDate ?? undefined,
      paymentLink: invoice.paymentLink ?? undefined,
      tenantName: tenant?.name ?? 'Your supplier',
    });

    await this.prisma.asAdmin((tx) =>
      Promise.all([
        (tx as any).reminderLog.create({
          data: {
            invoiceId: invoice.id,
            tenantId,
            ruleId: null,
            emailSentTo: invoice.buyerEmail,
            webhookDelivered: false,
          },
        }),
        tx.invoice.update({
          where: { id: invoice.id },
          data: {
            reminderCount: { increment: 1 },
            lastReminderAt: new Date(),
          },
        }),
      ]),
    );

    this.activityService.track({
      tenantId,
      eventType: 'REMINDER_SENT',
      actor,
      entityType: 'Invoice',
      entityId: invoice.id,
      payload: { manual: true, emailSentTo: invoice.buyerEmail },
    });

    return { message: 'Reminder sent', sentTo: invoice.buyerEmail };
  }
}
