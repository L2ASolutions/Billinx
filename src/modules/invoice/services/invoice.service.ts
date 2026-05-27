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
      (request.invoiceTypeCode === '381' ||
        request.invoiceTypeCode === '383') &&
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
      (request.invoiceTypeCode === '381' ||
        request.invoiceTypeCode === '383') &&
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
    const [total, accepted, rejected, pending, amountAgg, recentInvoices] =
      await this.prisma.asAdmin(async (tx) => {
        const total = await tx.invoice.count({ where: { tenantId } });
        const accepted = await tx.invoice.count({
          where: { tenantId, status: 'ACCEPTED' },
        });
        const rejected = await tx.invoice.count({
          where: { tenantId, status: 'REJECTED' },
        });
        const pending = await tx.invoice.count({
          where: { tenantId, status: { in: PENDING_STATUSES as any } },
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
        return [total, accepted, rejected, pending, amountAgg, recentInvoices] as const;
      });

    return {
      total,
      accepted,
      rejected,
      pending,
      totalAmount: Number(amountAgg._sum.totalAmount ?? 0),
      recentInvoices: recentInvoices.map((inv) => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
        createdAt: inv.createdAt.toISOString(),
      })),
    };
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
      '380': 'STANDARD',
      '381': 'CREDIT_NOTE',
      '383': 'DEBIT_NOTE',
      '325': 'PROFORMA',
    };
    return map[code] ?? 'STANDARD';
  }

  private mapToResponse(invoice: any): InvoiceResponse {
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      platformIrn: invoice.platformIrn,
      firsConfirmedIrn: invoice.firsConfirmedIrn ?? undefined,
      sourceReference: invoice.sourceReference ?? undefined,
      invoiceTypeCode: invoice.invoiceTypeCode,
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
      totalAmount: Number(invoice.totalAmount),
      lineItems: invoice.lineItems as any[],
      taxTotal: invoice.taxTotal as any[],
      legalMonetaryTotal: invoice.legalMonetaryTotal,
      paymentMeans: invoice.paymentMeans as any[],
      allowanceCharges: invoice.allowanceCharges as any[],
      note: invoice.note ?? undefined,
      qrCodeBase64: invoice.qrCodeBase64 ?? undefined,
      submittedAt: invoice.submittedAt?.toISOString(),
      acceptedAt: invoice.acceptedAt?.toISOString(),
      rejectedAt: invoice.rejectedAt?.toISOString(),
      cancelledAt: invoice.cancelledAt?.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }
}
