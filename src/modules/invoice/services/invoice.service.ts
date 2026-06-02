import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
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
        select: { tin: true, appAdapterKey: true },
      });
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const platformIrn = await this.irnService.generateUniqueIrn(tenant.tin);

    if (
      (request.invoiceTypeCode === '380' ||
        request.invoiceTypeCode === '384') &&
      !request.originalIrn
    ) {
      throw new BadRequestException(
        'Credit notes and debit notes must reference an original IRN',
      );
    }

    // Validate required string fields before the Prisma call so callers receive
    // a clear 400 BadRequest rather than a PrismaClientValidationError (which
    // would surface as a 500 and pollutes the system-error log).
    if (!request.seller?.tin) {
      throw new BadRequestException('seller.tin is required');
    }
    if (!request.seller?.partyName) {
      throw new BadRequestException('seller.partyName is required');
    }
    if (!request.buyer?.partyName) {
      throw new BadRequestException('buyer.partyName is required');
    }
    if (!request.issueDate) {
      throw new BadRequestException('issueDate is required');
    }

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
      taxPointDate: request.taxPointDate
        ? new Date(request.taxPointDate)
        : null,
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
      issueTime: request.issueTime ?? null,
      paymentStatus: request.paymentStatus ?? null,
      originalIrn: request.originalIrn ?? null,
      status: 'DRAFT',
      ...(request.whtApplicable ? (() => {
        const rate = request.whtRate ?? 5;
        const payable = request.legalMonetaryTotal?.payableAmount ?? 0;
        const whtAmt = parseFloat((payable * rate / 100).toFixed(2));
        return {
          whtApplicable: true,
          whtRate: rate,
          whtAmount: whtAmt,
          expectedCash: parseFloat((payable - whtAmt).toFixed(2)),
        };
      })() : { whtApplicable: false }),
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
          currency: request.currency ?? invoice.currency,
          invoiceKind: request.invoiceKind ?? (invoice as any).invoiceKind,
          subtotal:
            request.legalMonetaryTotal?.lineExtensionAmount ??
            invoice.subtotal,
          vatAmount:
            request.taxTotal?.length
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
          originalIrn:
            request.originalIrn ?? (invoice as any).originalIrn,
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
      .queueInvoice(
        invoiceId,
        tenantId,
        invoice.platformIrn,
        adapterKey as any,
      )
      .catch((err) =>
        this.logger.error(`Failed to queue draft invoice: ${err.message}`),
      );

    const updated = await this.invoiceRepository.findById(invoiceId);
    return this.mapToResponse(updated!);
  }

  async validateInvoice(request: any): Promise<ValidationResponse> {
    const errors: any[] = [];
    const warnings: any[] = [];

    if (!request.seller?.tin) {
      errors.push({
        field: 'seller.tin',
        code: 'MISSING_SELLER_TIN',
        message: 'Seller TIN is required',
        severity: 'ERROR',
      });
    }

    if (!request.seller?.partyName) {
      errors.push({
        field: 'seller.partyName',
        code: 'MISSING_SELLER_NAME',
        message: 'Seller name is required',
        severity: 'ERROR',
      });
    }

    if (!request.buyer?.partyName) {
      errors.push({
        field: 'buyer.partyName',
        code: 'MISSING_BUYER_NAME',
        message: 'Buyer name is required',
        severity: 'ERROR',
      });
    }

    if (!request.issueDate) {
      errors.push({
        field: 'issueDate',
        code: 'MISSING_ISSUE_DATE',
        message: 'Invoice issue date is required',
        severity: 'ERROR',
      });
    }

    if (!request.lineItems || request.lineItems.length === 0) {
      errors.push({
        field: 'lineItems',
        code: 'MISSING_LINE_ITEMS',
        message: 'Invoice must have at least one line item',
        severity: 'ERROR',
      });
    }

    if (request.lineItems) {
      request.lineItems.forEach((item: any, index: number) => {
        if (!item.hsnCode) {
          warnings.push({
            field: `lineItems[${index}].hsnCode`,
            code: 'MISSING_HSN_CODE',
            message: 'HSN code recommended for goods-based line items',
            severity: 'WARNING',
          });
        }
      });
    }

    if (
      (request.invoiceTypeCode === '380' ||
        request.invoiceTypeCode === '384') &&
      !request.originalIrn
    ) {
      errors.push({
        field: 'originalIrn',
        code: 'MISSING_ORIGINAL_IRN',
        message: 'Credit notes and debit notes must reference an original IRN',
        severity: 'ERROR',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
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

  async getDashboardStats(tenantId: string) {
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
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const endOfYesterday = new Date(startOfToday.getTime() - 1);
    const dayOfWeek = now.getDay();
    const daysToMonday = (dayOfWeek + 6) % 7;
    const startOfThisWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday);
    const startOfLastWeek = new Date(startOfThisWeek.getTime() - 7 * 86400000);
    const endOfLastWeek = new Date(startOfThisWeek.getTime() - 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
    const endOfLastYear = new Date(now.getFullYear(), 0, 0, 23, 59, 59, 999);

    const [
      total,
      accepted,
      rejected,
      rejectedAll,
      pending,
      draft,
      overdue,
      amountAgg,
      recentInvoices,
      outstandingAgg,
      overdueCount,
      collectedToday,
      collectedYesterday,
      collectedThisWeek,
      collectedLastWeek,
      collectedThisMonth,
      collectedLastMonth,
      collectedThisYear,
      collectedLastYear,
      outputVatAgg,
      inputVatAgg,
      whtExpectedAgg,
      whtCreditsAgg,
      pendingWhtCount,
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
          status: { in: ['REJECTED', 'SUBMISSION_FAILED', 'DEAD_LETTERED', 'VALIDATION_FAILED'] as any },
        },
      });
      const pending = await tx.invoice.count({
        where: { tenantId, status: { in: PENDING_STATUSES as any } },
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
      // paymentStatus is nullable — `{ not: 'PAID' }` excludes NULL rows in
      // PostgreSQL. Use OR to include invoices that have no payment recorded yet.
      const unpaidWhere = {
        tenantId,
        status: 'ACCEPTED' as const,
        OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }],
      };
      const outstandingAgg = await tx.invoice.aggregate({
        where: unpaidWhere,
        _sum: { totalAmount: true },
        _count: { id: true },
      });
      const overdueCount = await tx.invoice.count({
        where: { ...unpaidWhere, isOverdue: true },
      });
      const collectedToday = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfToday } },
        _sum: { amount: true },
      });
      const collectedYesterday = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfYesterday, lte: endOfYesterday } },
        _sum: { amount: true },
      });
      const collectedThisWeek = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfThisWeek } },
        _sum: { amount: true },
      });
      const collectedLastWeek = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfLastWeek, lte: endOfLastWeek } },
        _sum: { amount: true },
      });
      const collectedThisMonth = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
      });
      const collectedLastMonth = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { amount: true },
      });
      const collectedThisYear = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfYear } },
        _sum: { amount: true },
      });
      const collectedLastYear = await (tx as any).paymentRecord.aggregate({
        where: { tenantId, paidAt: { gte: startOfLastYear, lte: endOfLastYear } },
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
          OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }],
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
      return [
        total, accepted, rejected, rejectedAll, pending, draft, overdue,
        amountAgg, recentInvoices,
        outstandingAgg, overdueCount,
        collectedToday, collectedYesterday,
        collectedThisWeek, collectedLastWeek,
        collectedThisMonth, collectedLastMonth,
        collectedThisYear, collectedLastYear,
        outputVatAgg, inputVatAgg, whtExpectedAgg,
        whtCreditsAgg, pendingWhtCount,
      ] as const;
    });

    const outputVatOutstanding = Number(outputVatAgg._sum.vatAmount ?? 0);
    const inputVatOutstanding = Number(inputVatAgg._sum.vatAmount ?? 0);
    const totalWhtExpected = Number((whtExpectedAgg._sum as any).whtAmount ?? 0);
    const outstandingAmount = Number(outstandingAgg._sum.totalAmount ?? 0);
    const availableWhtCredits = Number((whtCreditsAgg._sum as any).whtDeducted ?? 0);
    const submissionAcceptanceRate = total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0;

    return {
      total,
      accepted,
      rejected,
      rejectedAll,
      pending,
      draft,
      overdue,
      outgoingTotal: total,
      outgoingAccepted: accepted,
      outgoingPending: pending,
      outgoingRejected: rejectedAll,
      totalAmount: Number(amountAgg._sum.totalAmount ?? 0),
      outstandingAmount,
      overdueCount,
      collectedToday: Number(collectedToday._sum.amount ?? 0),
      collectedYesterday: Number(collectedYesterday._sum.amount ?? 0),
      collectedThisWeek: Number(collectedThisWeek._sum.amount ?? 0),
      collectedLastWeek: Number(collectedLastWeek._sum.amount ?? 0),
      collectedThisMonth: Number(collectedThisMonth._sum.amount ?? 0),
      collectedLastMonth: Number(collectedLastMonth._sum.amount ?? 0),
      collectedThisYear: Number(collectedThisYear._sum.amount ?? 0),
      collectedLastYear: Number(collectedLastYear._sum.amount ?? 0),
      outstandingInvoiceCount: outstandingAgg._count.id,
      outputVatOutstanding,
      inputVatOutstanding,
      netVatExposure: outputVatOutstanding - inputVatOutstanding,
      totalWhtExpected,
      expectedCashCollections: outstandingAmount - totalWhtExpected,
      availableWhtCredits,
      pendingWhtCertificates: pendingWhtCount,
      submissionAcceptanceRate,
      recentInvoices: recentInvoices.map((inv) => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
        createdAt: inv.createdAt.toISOString(),
      })),
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
      const collectionRate = totalBilled > 0
        ? Math.round((totalCollected / totalBilled) * 100)
        : 0;

      const [paidInFull, partiallyPaid, overdue, accepted] = await Promise.all([
        tx.invoice.count({ where: { tenantId, status: 'ACCEPTED', paymentStatus: 'PAID' } }),
        tx.invoice.count({ where: { tenantId, status: 'ACCEPTED', paymentStatus: 'PARTIAL' } }),
        tx.invoice.count({ where: { tenantId, status: 'ACCEPTED', isOverdue: true } }),
        tx.invoice.count({ where: { tenantId, status: 'ACCEPTED' } }),
      ]);
      const unpaidNotDue = accepted - paidInFull - partiallyPaid - overdue;

      const providerRows = await (tx as any).paymentRecord.groupBy({
        by: ['provider'],
        where: { tenantId },
        _sum: { amount: true },
      });
      const knownProviders = ['BANK_TRANSFER', 'PAYSTACK', 'FLUTTERWAVE', 'MANUAL'];
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
        collectionRate,
        paidInFull,
        partiallyPaid,
        unpaidNotDue: Math.max(0, unpaidNotDue),
        overdue,
        providerBreakdown,
      };
    });
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
      '381': 'STANDARD',     // Commercial Invoice
      '380': 'CREDIT_NOTE',  // Credit Note
      '384': 'DEBIT_NOTE',   // Debit Note
      '390': 'PROFORMA',     // Proforma Invoice
      '385': 'STANDARD',     // Self Billed Invoice → STANDARD
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
      invoiceType: typeNameMap[invoice.invoiceTypeCode] ?? invoice.invoiceTypeCode,
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
          : invoice.paymentDueDate ?? undefined,
      isOverdue: invoice.isOverdue ?? false,
      lineItems: invoice.lineItems as any[],
      taxTotal: invoice.taxTotal as any[],
      legalMonetaryTotal: invoice.legalMonetaryTotal,
      paymentMeans: invoice.paymentMeans as any[],
      allowanceCharges: invoice.allowanceCharges as any[],
      note: invoice.note ?? undefined,
      buyerReference: invoice.buyerReference ?? undefined,
      orderReference: invoice.orderReference ?? undefined,
      paymentTermsNote: invoice.paymentTermsNote ?? undefined,
      actualDeliveryDate: invoice.actualDeliveryDate
        ? (invoice.actualDeliveryDate instanceof Date
            ? invoice.actualDeliveryDate.toISOString()
            : invoice.actualDeliveryDate)
        : undefined,
      deliveryPeriodStart: invoice.deliveryPeriodStart
        ? (invoice.deliveryPeriodStart instanceof Date
            ? invoice.deliveryPeriodStart.toISOString()
            : invoice.deliveryPeriodStart)
        : undefined,
      deliveryPeriodEnd: invoice.deliveryPeriodEnd
        ? (invoice.deliveryPeriodEnd instanceof Date
            ? invoice.deliveryPeriodEnd.toISOString()
            : invoice.deliveryPeriodEnd)
        : undefined,
      seller: (invoice.metadata as any)?.sellerParty ?? undefined,
      buyer: (invoice.metadata as any)?.buyerParty ?? undefined,
      qrCodeBase64: invoice.qrCodeBase64 ?? undefined,
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
      whtAmount: invoice.whtAmount != null ? Number(invoice.whtAmount) : undefined,
      expectedCash: invoice.expectedCash != null ? Number(invoice.expectedCash) : undefined,
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
      tx.tenant.findUnique({ where: { id: tenantId }, select: { tin: true } }),
    );
    const platformIrn = await this.irnService.generateUniqueIrn(
      tenant?.tin ?? tenantId,
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
      paymentStatus: null,
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
}
