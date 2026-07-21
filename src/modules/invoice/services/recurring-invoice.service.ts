import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { InvoiceService } from './invoice.service';
import {
  InvoiceValidationService,
  InvoiceValidationDto,
} from './invoice-validation.service';
import { NotificationService } from '../../notification/notification.service';
import { runWithContext } from '../../../shared/context/request-context';
import { RequestContext } from '../../../../packages/types/identity';

export const RECURRING_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUALLY',
] as const;
export type RecurringFrequencyType = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type RecurringStatusType = (typeof RECURRING_STATUSES)[number];

export interface RecurringLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
  taxCategory?: string;
  priceUnit?: string;
  itemType?: 'product' | 'service' | 'PRODUCT' | 'SERVICE';
  hsnCode?: string;
  productCategory?: string;
  isicCode?: string;
  serviceCategory?: string;
}

export interface RecurringBuyer {
  name: string;
  tin?: string;
  email?: string;
  address?: string;
}

export interface RecurringTemplateData {
  invoiceKind: string;
  invoiceTypeCode: string | number;
  currency?: string;
  notes?: string;
  buyer: RecurringBuyer;
  lineItems: RecurringLineItem[];
}

export interface CreateRecurringInvoiceDto {
  name: string;
  frequency: RecurringFrequencyType;
  startDate: string;
  endDate?: string;
  autoSubmit?: boolean;
  autoSend?: boolean;
  templateData: RecurringTemplateData;
}

export interface UpdateRecurringInvoiceDto {
  name?: string;
  frequency?: RecurringFrequencyType;
  startDate?: string;
  endDate?: string | null;
  autoSubmit?: boolean;
  autoSend?: boolean;
  templateData?: RecurringTemplateData;
}

export interface RecurringInvoiceRecord {
  id: string;
  tenantId: string;
  name: string;
  frequency: RecurringFrequencyType;
  startDate: Date;
  endDate: Date | null;
  nextRunDate: Date;
  status: RecurringStatusType;
  autoSubmit: boolean;
  autoSend: boolean;
  templateData: unknown;
  lastRunAt: Date | null;
  invoiceCount: number;
}

// Every generated invoice is a standard Invoice record — the only special
// handling recurring invoices get is this tenant-scoped, non-HTTP CLS
// context. InvoiceService/ActivityService/NotificationService all write via
// PrismaService's RLS-scoped main client (or asAdmin() with manual tenantId
// filters), and the main client only sets the Postgres
// app.current_tenant_id GUC when a request context is present (see
// PrismaService.applyRlsExtension). A cron tick has no HTTP request, so
// runWithContext() stands in for the guard that would normally populate
// this context — exactly the same mechanism JwtGuard/ApiKeyGuard use.
function buildSystemContext(
  tenantId: string,
  environment: string,
): RequestContext {
  return {
    tenantId,
    environment: environment as RequestContext['environment'],
    tier: 'STANDARD',
    actor: 'system:recurring-invoice',
    actorType: 'system',
    requestId: crypto.randomUUID(),
    isAdmin: false,
  };
}

@Injectable()
export class RecurringInvoiceService {
  private readonly logger = new Logger(RecurringInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly validationService: InvoiceValidationService,
    private readonly notificationService: NotificationService,
  ) {}

  // ── Next-run-date calculation ──────────────────────────────────────────────
  // MONTHLY/QUARTERLY/ANNUALLY all clamp to the last day of the target month
  // when the source day doesn't exist there (e.g. Jan 31 + 1 month -> Feb 28,
  // not the JS Date default rollover to Mar 3). WEEKLY is plain +7 days.

  calculateNextRunDate(from: Date, frequency: RecurringFrequencyType): Date {
    switch (frequency) {
      case 'WEEKLY': {
        const next = new Date(from);
        next.setUTCDate(next.getUTCDate() + 7);
        return next;
      }
      case 'MONTHLY':
        return this.addMonthsClamped(from, 1);
      case 'QUARTERLY':
        return this.addMonthsClamped(from, 3);
      case 'ANNUALLY':
        return this.addMonthsClamped(from, 12);
      default:
        throw new BadRequestException(
          `Unrecognized frequency: ${String(frequency)}`,
        );
    }
  }

  private addMonthsClamped(from: Date, months: number): Date {
    const day = from.getUTCDate();
    const result = new Date(from);
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const daysInTargetMonth = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(day, daysInTargetMonth));
    return result;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createSchedule(tenantId: string, dto: CreateRecurringInvoiceDto) {
    this.assertValidDto(dto);

    const startDate = new Date(dto.startDate);
    if (Number.isNaN(startDate.getTime())) {
      throw new BadRequestException('startDate must be a valid date');
    }
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('endDate must be a valid date');
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    if (dto.autoSubmit) {
      await this.assertTemplateIsSubmittable(tenantId, dto.templateData);
    }

    const schedule = await this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.create({
        data: {
          tenantId,
          name: dto.name,
          frequency: dto.frequency,
          startDate,
          endDate,
          nextRunDate: startDate,
          autoSubmit: dto.autoSubmit ?? false,
          autoSend: dto.autoSend ?? false,
          templateData: dto.templateData as any,
        },
      }),
    );

    return schedule;
  }

  async listSchedules(tenantId: string) {
    return this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async getSchedule(tenantId: string, id: string) {
    return this.findScheduleOrThrow(tenantId, id);
  }

  async updateSchedule(
    tenantId: string,
    id: string,
    dto: UpdateRecurringInvoiceDto,
  ) {
    const existing = await this.findScheduleOrThrow(tenantId, id);

    const frequency = dto.frequency ?? existing.frequency;
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate;
    if (Number.isNaN(startDate.getTime())) {
      throw new BadRequestException('startDate must be a valid date');
    }

    let endDate = existing.endDate;
    if (dto.endDate !== undefined) {
      endDate = dto.endDate ? new Date(dto.endDate) : null;
      if (endDate && Number.isNaN(endDate.getTime())) {
        throw new BadRequestException('endDate must be a valid date');
      }
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    const templateData = dto.templateData ?? existing.templateData;
    const autoSubmit = dto.autoSubmit ?? existing.autoSubmit;
    if (dto.templateData) {
      this.assertValidTemplateData(dto.templateData);
    }
    if (autoSubmit) {
      await this.assertTemplateIsSubmittable(
        tenantId,
        templateData as RecurringTemplateData,
      );
    }

    // A frequency or startDate change re-anchors nextRunDate only when the
    // schedule hasn't run yet — once invoices have been generated, shifting
    // nextRunDate backwards on every metadata edit would risk re-firing a
    // period that's already been billed.
    const nextRunDate =
      existing.invoiceCount === 0 && (dto.frequency || dto.startDate)
        ? startDate
        : existing.nextRunDate;

    return this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          frequency,
          startDate,
          endDate,
          nextRunDate,
          autoSubmit,
          autoSend: dto.autoSend ?? existing.autoSend,
          templateData: templateData as any,
        },
      }),
    );
  }

  async pauseSchedule(tenantId: string, id: string) {
    const existing = await this.findScheduleOrThrow(tenantId, id);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Only ACTIVE schedules can be paused (current status: ${existing.status})`,
      );
    }
    return this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.update({
        where: { id },
        data: { status: 'PAUSED' },
      }),
    );
  }

  async resumeSchedule(tenantId: string, id: string) {
    const existing = await this.findScheduleOrThrow(tenantId, id);
    if (existing.status !== 'PAUSED') {
      throw new BadRequestException(
        `Only PAUSED schedules can be resumed (current status: ${existing.status})`,
      );
    }

    // Catch nextRunDate up to today if the schedule sat paused through one
    // or more would-have-been run dates, without generating a burst of
    // backdated invoices for the missed periods.
    let nextRunDate = existing.nextRunDate;
    const now = new Date();
    while (nextRunDate < now) {
      nextRunDate = this.calculateNextRunDate(nextRunDate, existing.frequency);
    }

    return this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.update({
        where: { id },
        data: { status: 'ACTIVE', nextRunDate },
      }),
    );
  }

  async cancelSchedule(tenantId: string, id: string) {
    const existing = await this.findScheduleOrThrow(tenantId, id);
    if (existing.status === 'CANCELLED') {
      return existing;
    }
    return this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
    );
  }

  private async findScheduleOrThrow(
    tenantId: string,
    id: string,
  ): Promise<RecurringInvoiceRecord> {
    const schedule = await this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.findUnique({ where: { id } }),
    );
    if (!schedule || schedule.tenantId !== tenantId) {
      throw new NotFoundException(`Recurring invoice schedule ${id} not found`);
    }
    return schedule;
  }

  private assertValidDto(dto: CreateRecurringInvoiceDto): void {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!RECURRING_FREQUENCIES.includes(dto.frequency)) {
      throw new BadRequestException(
        `frequency must be one of ${RECURRING_FREQUENCIES.join(', ')}`,
      );
    }
    if (!dto.startDate) {
      throw new BadRequestException('startDate is required');
    }
    this.assertValidTemplateData(dto.templateData);
  }

  private assertValidTemplateData(templateData: RecurringTemplateData): void {
    if (!templateData) {
      throw new BadRequestException('templateData is required');
    }
    if (!templateData.buyer?.name?.trim()) {
      throw new BadRequestException('templateData.buyer.name is required');
    }
    if (
      !Array.isArray(templateData.lineItems) ||
      templateData.lineItems.length === 0
    ) {
      throw new BadRequestException(
        'templateData.lineItems must contain at least one line item',
      );
    }
  }

  // Pre-flight, VALIDATE-context check run at create/update time whenever
  // autoSubmit is true — without this, a bad schedule would silently fail
  // every day in the cron log instead of failing loudly when the user sets
  // it up. Not required when autoSubmit is false, since saveDraftInvoice()
  // (used for every run regardless of autoSubmit) applies the same
  // DRAFT-permissive rules the New Invoice dashboard form gets today.
  private async assertTemplateIsSubmittable(
    tenantId: string,
    templateData: RecurringTemplateData,
  ): Promise<void> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { tin: true, name: true },
      }),
    );
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const normalisedLineItems = this.invoiceService.normaliseLineItems(
      templateData.lineItems,
    );
    const totals = this.calculateTotals(templateData.lineItems);

    const dto: InvoiceValidationDto = {
      invoiceTypeCode: String(templateData.invoiceTypeCode ?? ''),
      invoiceKind: templateData.invoiceKind,
      seller: { tin: tenant.tin, partyName: tenant.name },
      buyer: {
        tin: templateData.buyer?.tin,
        partyName: templateData.buyer?.name,
      },
      issueDate: new Date().toISOString(),
      lineItems: normalisedLineItems,
      totalAmount: totals.legalMonetaryTotal.payableAmount,
      legalMonetaryTotal: totals.legalMonetaryTotal,
      taxTotal: totals.taxTotal,
    };

    const result = this.validationService.validateInvoiceFields(
      dto,
      'VALIDATE',
    );
    if (!result.valid) {
      throw new BadRequestException({
        message:
          'templateData fails FIRS submission validation (autoSubmit is enabled, so this schedule must be submit-ready)',
        errors: result.errors,
      });
    }
  }

  private calculateTotals(lineItems: RecurringLineItem[]): {
    taxTotal: Array<{ taxAmount: number }>;
    legalMonetaryTotal: {
      lineExtensionAmount: number;
      taxExclusiveAmount: number;
      taxInclusiveAmount: number;
      payableAmount: number;
    };
  } {
    // Deliberately the same flat, discount-free formula the New Invoice
    // dashboard form uses (qty * unitPrice, flat vatRate per line) — see
    // the recurring-invoices PR discussion. Discount-aware totals affect
    // all invoice creation paths, not just recurring, and are tracked as a
    // separate follow-up rather than being special-cased here.
    const { subtotal, tax } = lineItems.reduce(
      (acc, item) => {
        const sub = item.quantity * item.unitPrice;
        const vat = sub * ((item.vatRate ?? 7.5) / 100);
        return { subtotal: acc.subtotal + sub, tax: acc.tax + vat };
      },
      { subtotal: 0, tax: 0 },
    );

    return {
      taxTotal: [{ taxAmount: tax }],
      legalMonetaryTotal: {
        lineExtensionAmount: subtotal,
        taxExclusiveAmount: subtotal,
        taxInclusiveAmount: subtotal + tax,
        payableAmount: subtotal + tax,
      },
    };
  }

  // ── Cron entry point ──────────────────────────────────────────────────────

  async runDueSchedules(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const now = new Date();

    const dueSchedules: RecurringInvoiceRecord[] =
      await this.prisma.asAdmin<any>((tx) =>
        (tx as any).recurringInvoice.findMany({
          where: { status: 'ACTIVE', nextRunDate: { lte: now } },
        }),
      );

    let succeeded = 0;
    let failed = 0;

    for (const schedule of dueSchedules) {
      try {
        await this.processSchedule(schedule);
        succeeded++;
        this.logger.log(
          `Recurring invoice generated for schedule ${schedule.id} (${schedule.name})`,
        );
      } catch (err: any) {
        failed++;
        this.logger.error(
          `Recurring invoice schedule ${schedule.id} (${schedule.name}) failed: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Recurring invoice run complete — ${dueSchedules.length} due, ${succeeded} succeeded, ${failed} failed`,
    );

    return { processed: dueSchedules.length, succeeded, failed };
  }

  // Not private: unit tests drive a single schedule through processSchedule
  // directly rather than going through the date-filtered runDueSchedules().
  async processSchedule(schedule: RecurringInvoiceRecord): Promise<void> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: schedule.tenantId },
        select: {
          tin: true,
          name: true,
          registeredAddress: true,
          environment: true,
          isActive: true,
        },
      }),
    );

    if (!tenant || !tenant.isActive) {
      throw new Error(
        `Tenant ${schedule.tenantId} not found or inactive — skipping schedule ${schedule.id}`,
      );
    }

    const template = schedule.templateData as RecurringTemplateData;
    const totals = this.calculateTotals(template.lineItems);
    const ctx = buildSystemContext(schedule.tenantId, tenant.environment);
    const today = new Date().toISOString().slice(0, 10);

    const sellerPayload = {
      tin: tenant.tin,
      partyName: tenant.name,
      postalAddress: tenant.registeredAddress ?? undefined,
    };
    const buyerPayload = {
      partyName: template.buyer?.name,
      tin: template.buyer?.tin,
      email: template.buyer?.email,
      postalAddress: template.buyer?.address
        ? { streetName: template.buyer.address, country: 'NG' }
        : undefined,
    };

    await runWithContext(ctx, async () => {
      const draft = await this.invoiceService.saveDraftInvoice(
        schedule.tenantId,
        ctx.environment,
        ctx.actor,
        {
          invoiceTypeCode: String(template.invoiceTypeCode),
          invoiceKind: template.invoiceKind,
          currency: template.currency ?? 'NGN',
          issueDate: today,
          note: template.notes ?? null,
          sourceReference: `recurring:${schedule.id}:${today}`,
          seller: sellerPayload,
          buyer: buyerPayload,
          lineItems: template.lineItems,
          taxTotal: totals.taxTotal,
          legalMonetaryTotal: totals.legalMonetaryTotal,
        },
      );

      await this.prisma.invoice.update({
        where: { id: draft.id },
        data: { recurringInvoiceId: schedule.id },
      });

      // autoSend is not attempted here even when true — sendToBuyer()
      // requires status ACCEPTED, which only exists after the async FIRS
      // submission worker (queued by submitDraft(), below) completes.
      // See the onInvoiceAccepted() event handler further down, which is
      // what actually fires the send once (and if) that happens.
      if (schedule.autoSubmit) {
        try {
          // Re-sends seller/buyer, not an empty body: submitDraft()'s own
          // metadata merge is `sellerParty: request.seller ?? null` (no
          // fallback to the existing value), so an empty body here would
          // silently null out the sellerParty/buyerParty metadata that
          // saveDraftInvoice() just set — breaking sendToBuyer()'s
          // buyerParty.email fallback for autoSend. Caught via live
          // verification, not by the unit tests (which mock submitDraft).
          await this.invoiceService.submitDraft(
            draft.id,
            schedule.tenantId,
            ctx.actor,
            { seller: sellerPayload, buyer: buyerPayload },
          );
        } catch (err: any) {
          // Thrown by submitDraft()'s SUBMIT-context field validation,
          // which runs before any DB mutation — the invoice this created
          // is untouched and still DRAFT. This is the "leave as Draft"
          // case from the spec. A true async NRS rejection (after the
          // invoice has actually been queued) is a separate, later event
          // handled by onInvoiceRejected() below — by then the invoice is
          // already past DRAFT and reverting it would bypass
          // StateMachineService, which this codebase never does.
          this.logger.warn(
            `Auto-submit failed for schedule ${schedule.id}, invoice ${draft.id} left as DRAFT: ${err.message}`,
          );
          await this.notifyTenant(
            schedule.tenantId,
            'recurring_auto_submit_failed',
            'Recurring invoice could not be auto-submitted',
            `"${schedule.name}" generated invoice ${draft.platformIrn} but it failed FIRS submission validation and has been left as a Draft for you to review: ${err.message}`,
            `/invoices/${draft.id}`,
          );
        }
      }

      await this.advanceSchedule(schedule);
    });
  }

  private async advanceSchedule(
    schedule: RecurringInvoiceRecord,
  ): Promise<void> {
    const nextRunDate = this.calculateNextRunDate(
      schedule.nextRunDate,
      schedule.frequency,
    );
    const completed = schedule.endDate ? nextRunDate > schedule.endDate : false;

    await this.prisma.asAdmin((tx) =>
      (tx as any).recurringInvoice.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          invoiceCount: { increment: 1 },
          nextRunDate,
          status: completed ? 'COMPLETED' : schedule.status,
        },
      }),
    );
  }

  private async notifyTenant(
    tenantId: string,
    type: string,
    title: string,
    body: string,
    link: string,
  ): Promise<void> {
    try {
      const [ownerRole, tenant] = await Promise.all([
        this.prisma.asAdmin((tx) =>
          tx.userRole.findFirst({
            where: { tenantId, role: 'OWNER' },
            include: { user: { select: { id: true, isActive: true } } },
          }),
        ),
        this.prisma.asAdmin((tx) =>
          tx.tenant.findUnique({
            where: { id: tenantId },
            select: { environment: true },
          }),
        ),
      ]);
      if (!ownerRole?.user?.isActive) return;

      const ctx = buildSystemContext(
        tenantId,
        tenant?.environment ?? 'SANDBOX',
      );
      await runWithContext(ctx, () =>
        this.notificationService.create({
          tenantId,
          userId: ownerRole.user.id,
          type,
          title,
          body,
          link,
        }),
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to notify tenant ${tenantId} of recurring-invoice event: ${err.message}`,
      );
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  // A generated invoice only knows its recurringInvoiceId, so both handlers
  // look the invoice up first and no-op immediately for the (overwhelming
  // majority) non-recurring case.

  @OnEvent('invoice.accepted')
  async onInvoiceAccepted(event: {
    tenantId: string;
    data?: { invoiceId?: string };
  }): Promise<void> {
    const invoiceId = event?.data?.invoiceId;
    if (!invoiceId) return;

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, tenantId: true, recurringInvoiceId: true },
      }),
    );
    if (!invoice?.recurringInvoiceId) return;

    const schedule = await this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.findUnique({
        where: { id: invoice.recurringInvoiceId },
      }),
    );
    if (!schedule?.autoSend) return;

    try {
      await this.invoiceService.sendToBuyer(invoice.id, invoice.tenantId);
    } catch (err: any) {
      this.logger.warn(
        `Auto-send failed for recurring invoice ${invoice.id} (schedule ${schedule.id}): ${err.message}`,
      );
    }
  }

  @OnEvent('invoice.rejected')
  async onInvoiceRejected(event: {
    tenantId: string;
    data?: { invoiceId?: string; errorMessage?: string };
  }): Promise<void> {
    const invoiceId = event?.data?.invoiceId;
    if (!invoiceId) return;

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          tenantId: true,
          platformIrn: true,
          recurringInvoiceId: true,
        },
      }),
    );
    if (!invoice?.recurringInvoiceId) return;

    const schedule = await this.prisma.asAdmin<any>((tx) =>
      (tx as any).recurringInvoice.findUnique({
        where: { id: invoice.recurringInvoiceId },
      }),
    );
    if (!schedule) return;

    await this.notifyTenant(
      invoice.tenantId,
      'recurring_auto_submit_rejected',
      'Recurring invoice was rejected by FIRS',
      `"${schedule.name}" generated invoice ${invoice.platformIrn}, which FIRS rejected: ${
        event.data?.errorMessage ?? 'no reason given'
      }. Review it and correct the recurring schedule if needed.`,
      `/invoices/${invoice.id}`,
    );
  }
}
