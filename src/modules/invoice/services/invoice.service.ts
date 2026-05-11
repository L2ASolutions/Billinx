import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InvoiceRepository } from "../repositories/invoice.repository";
import { IrnService } from "./irn.service";
import { StateMachineService } from "./state-machine.service";
import { ActivityService } from "../../activity/services/activity.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import {
  InvoiceResponse,
  InvoiceListResponse,
  InvoiceStatusResponse,
  InvoiceFilterParams,
  CancelInvoiceRequest,
  ValidationResponse,
} from "../../../../packages/types/invoice";

import { SubmissionService } from "../../submission/services/submission.service";

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
  ) {}

  async createInvoice(
    tenantId: string,
    environment: string,
    actor: string,
    request: any,
  ): Promise<InvoiceResponse> {
    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { tin: true, appAdapterKey: true },
      });
    });

    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }

    const platformIrn = await this.irnService.generateUniqueIrn(tenant.tin);

    if (
      (request.invoiceTypeCode === "381" || request.invoiceTypeCode === "383") &&
      !request.originalIrn
    ) {
      throw new BadRequestException(
        "Credit notes and debit notes must reference an original IRN",
      );
    }

    const invoice = await this.invoiceRepository.create({
      tenantId,
      environment,
      schemaVersion: request.schemaVersion ?? "2.0",
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
      taxPointDate: request.taxPointDate ? new Date(request.taxPointDate) : null,
      actualDeliveryDate: request.actualDeliveryDate
        ? new Date(request.actualDeliveryDate)
        : null,
      currency: request.currency ?? "NGN",
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
      metadata: request.metadata
        ? JSON.parse(JSON.stringify(request.metadata))
        : null,
      originalIrn: request.originalIrn ?? null,
      status: "DRAFT",
    });

    await this.invoiceRepository.addStateHistory({
      invoiceId: invoice.id,
      tenantId,
      toStatus: "DRAFT",
      actor,
      reason: "Invoice created",
    });

    this.activityService.track({
      tenantId,
      eventType: "INVOICE_CREATED",
      actor,
      entityType: "Invoice",
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

    this.logger.log(`Invoice created: ${platformIrn} for tenant ${tenantId}`);
     // Queue invoice for FIRS submission
    const tenantData = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { appAdapterKey: true },
      });
    });

    this.submissionService.queueInvoice(
      invoice.id,
      tenantId,
      platformIrn,
      (tenantData?.appAdapterKey ?? "mock") as any,
    ).catch((err) =>
      this.logger.error(`Failed to queue invoice: ${err.message}`),
    );
    return this.mapToResponse(invoice);
  }

  async validateInvoice(request: any): Promise<ValidationResponse> {
    const errors: any[] = [];
    const warnings: any[] = [];

    if (!request.seller?.tin) {
      errors.push({
        field: "seller.tin",
        code: "MISSING_SELLER_TIN",
        message: "Seller TIN is required",
        severity: "ERROR",
      });
    }

    if (!request.seller?.partyName) {
      errors.push({
        field: "seller.partyName",
        code: "MISSING_SELLER_NAME",
        message: "Seller name is required",
        severity: "ERROR",
      });
    }

    if (!request.buyer?.partyName) {
      errors.push({
        field: "buyer.partyName",
        code: "MISSING_BUYER_NAME",
        message: "Buyer name is required",
        severity: "ERROR",
      });
    }

    if (!request.issueDate) {
      errors.push({
        field: "issueDate",
        code: "MISSING_ISSUE_DATE",
        message: "Invoice issue date is required",
        severity: "ERROR",
      });
    }

    if (!request.lineItems || request.lineItems.length === 0) {
      errors.push({
        field: "lineItems",
        code: "MISSING_LINE_ITEMS",
        message: "Invoice must have at least one line item",
        severity: "ERROR",
      });
    }

    if (request.lineItems) {
      request.lineItems.forEach((item: any, index: number) => {
        if (!item.hsnCode) {
          warnings.push({
            field: `lineItems[${index}].hsnCode`,
            code: "MISSING_HSN_CODE",
            message: "HSN code recommended for goods-based line items",
            severity: "WARNING",
          });
        }
      });
    }

    if (
      (request.invoiceTypeCode === "381" || request.invoiceTypeCode === "383") &&
      !request.originalIrn
    ) {
      errors.push({
        field: "originalIrn",
        code: "MISSING_ORIGINAL_IRN",
        message: "Credit notes and debit notes must reference an original IRN",
        severity: "ERROR",
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
      status: invoice.status as any,
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
  ): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (invoice.status !== "ACCEPTED") {
      throw new BadRequestException(
        `Only accepted invoices can be cancelled. Current status: ${invoice.status}`,
      );
    }

    this.stateMachine.assertValidTransition(
      invoice.status as any,
      "CANCELLATION_REQUESTED",
    );

    const updated = await this.invoiceRepository.updateStatus(
      id,
      "CANCELLATION_REQUESTED",
      { cancelledAt: new Date() },
    );

    await this.invoiceRepository.addStateHistory({
      invoiceId: id,
      tenantId,
      fromStatus: invoice.status,
      toStatus: "CANCELLATION_REQUESTED",
      actor,
      reason: request.reason,
    });

    this.activityService.track({
      tenantId,
      eventType: "INVOICE_CANCELLED",
      actor,
      entityType: "Invoice",
      entityId: id,
      payload: {
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

  private mapInvoiceTypeCode(code: string): string {
    const map: Record<string, string> = {
      "380": "STANDARD",
      "381": "CREDIT_NOTE",
      "383": "DEBIT_NOTE",
      "325": "PROFORMA",
    };
    return map[code] ?? "STANDARD";
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