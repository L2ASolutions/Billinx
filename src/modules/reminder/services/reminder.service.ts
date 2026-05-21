import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ActivityService } from '../../activity/services/activity.service';
import { EmailService } from '../../../shared/email/email.service';

const VALID_TRIGGER_TYPES = [
  'DAYS_BEFORE_DUE',
  'ON_DUE_DATE',
  'DAYS_AFTER_DUE',
] as const;
type ReminderTriggerType = (typeof VALID_TRIGGER_TYPES)[number];

const DEFAULT_RULES: Array<{
  name: string;
  triggerType: ReminderTriggerType;
  triggerDays: number;
}> = [
  { name: '3 days before due', triggerType: 'DAYS_BEFORE_DUE', triggerDays: 3 },
  { name: 'On due date', triggerType: 'ON_DUE_DATE', triggerDays: 0 },
  { name: '7 days after due', triggerType: 'DAYS_AFTER_DUE', triggerDays: 7 },
  { name: '14 days after due', triggerType: 'DAYS_AFTER_DUE', triggerDays: 14 },
  { name: '30 days after due', triggerType: 'DAYS_AFTER_DUE', triggerDays: 30 },
];

export interface CreateReminderRuleDto {
  name: string;
  triggerType: string;
  triggerDays: number;
  reminderMessage?: string;
}

export interface UpdateReminderRuleDto {
  name?: string;
  triggerType?: string;
  triggerDays?: number;
  isActive?: boolean;
  reminderMessage?: string;
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activityService: ActivityService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Default rules (called on tenant creation) ──────────────────────────────

  async createDefaultRules(tenantId: string): Promise<void> {
    await this.prisma.asAdmin((tx) =>
      tx.reminderRule.createMany({
        data: DEFAULT_RULES.map((r) => ({ ...r, tenantId })),
        skipDuplicates: true,
      }),
    );
    this.logger.log(`Created default reminder rules for tenant ${tenantId}`);
  }

  // ─── CRUD for reminder rules ─────────────────────────────────────────────────

  async listRules(tenantId: string) {
    const rules = await this.prisma.asAdmin((tx) =>
      tx.reminderRule.findMany({
        where: { tenantId },
        orderBy: [{ triggerType: 'asc' }, { triggerDays: 'asc' }],
      }),
    );
    return { data: rules.map((r) => this.mapRule(r)), total: rules.length };
  }

  async createRule(tenantId: string, dto: CreateReminderRuleDto) {
    this.validateTriggerType(dto.triggerType);
    this.validateTriggerDays(
      dto.triggerType as ReminderTriggerType,
      dto.triggerDays,
    );

    const rule = await this.prisma.asAdmin((tx) =>
      tx.reminderRule.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          triggerType: dto.triggerType as ReminderTriggerType,
          triggerDays: dto.triggerDays,
          reminderMessage: dto.reminderMessage?.trim() ?? null,
        },
      }),
    );

    return this.mapRule(rule);
  }

  async updateRule(
    tenantId: string,
    ruleId: string,
    dto: UpdateReminderRuleDto,
  ) {
    const existing = await this.findRuleOrThrow(tenantId, ruleId);

    const triggerType = (dto.triggerType ??
      existing.triggerType) as ReminderTriggerType;
    const triggerDays = dto.triggerDays ?? existing.triggerDays;

    if (dto.triggerType) this.validateTriggerType(dto.triggerType);
    this.validateTriggerDays(triggerType, triggerDays);

    const updated = await this.prisma.asAdmin((tx) =>
      tx.reminderRule.update({
        where: { id: ruleId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.triggerType !== undefined && {
            triggerType: dto.triggerType as ReminderTriggerType,
          }),
          ...(dto.triggerDays !== undefined && {
            triggerDays: dto.triggerDays,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.reminderMessage !== undefined && {
            reminderMessage: dto.reminderMessage?.trim() ?? null,
          }),
        },
      }),
    );

    return this.mapRule(updated);
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<void> {
    await this.findRuleOrThrow(tenantId, ruleId);

    await this.prisma.asAdmin((tx) =>
      tx.reminderRule.delete({ where: { id: ruleId } }),
    );
  }

  // ─── Cron: daily reminder check at 8am UTC ───────────────────────────────────

  @Cron('0 8 * * *')
  async runDailyReminderCheck(): Promise<void> {
    this.logger.log('Running daily payment reminder check');
    await this.runReminderCheck();
  }

  async runReminderCheck(targetTenantId?: string): Promise<{
    processed: number;
    sent: number;
    skipped: number;
  }> {
    const today = this.startOfDay(new Date());

    const tenantFilter = targetTenantId
      ? { id: targetTenantId }
      : { isActive: true };

    const tenants = await this.prisma.asAdmin((tx) =>
      tx.tenant.findMany({
        where: tenantFilter,
        select: { id: true },
      }),
    );

    let totalProcessed = 0;
    let totalSent = 0;
    let totalSkipped = 0;

    for (const tenant of tenants) {
      const { sent, skipped } = await this.processTenanReminders(
        tenant.id,
        today,
      );
      totalProcessed++;
      totalSent += sent;
      totalSkipped += skipped;
    }

    this.logger.log(
      `Reminder check complete — ${totalProcessed} tenants, ${totalSent} sent, ${totalSkipped} skipped`,
    );

    return {
      processed: totalProcessed,
      sent: totalSent,
      skipped: totalSkipped,
    };
  }

  // ─── Per-tenant reminder processing ─────────────────────────────────────────

  private async processTenanReminders(
    tenantId: string,
    today: Date,
  ): Promise<{ sent: number; skipped: number }> {
    const [rules, invoices, ownerEmail] = await Promise.all([
      this.prisma.asAdmin((tx) =>
        tx.reminderRule.findMany({
          where: { tenantId, isActive: true },
        }),
      ),
      this.prisma.asAdmin((tx) =>
        tx.invoice.findMany({
          where: {
            tenantId,
            status: 'ACCEPTED',
            paymentDueDate: { not: null },
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
            reminderCount: true,
            firsConfirmedIrn: true,
            reminderLogs: { select: { ruleId: true } },
          },
        }),
      ),
      this.getOwnerEmail(tenantId),
    ]);

    if (!ownerEmail || rules.length === 0 || invoices.length === 0) {
      return { sent: 0, skipped: 0 };
    }

    let sent = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const sentRuleIds = new Set(invoice.reminderLogs.map((l) => l.ruleId));

      for (const rule of rules) {
        if (sentRuleIds.has(rule.id)) {
          skipped++;
          continue;
        }

        const dueDate = this.startOfDay(invoice.paymentDueDate!);
        const diffDays = this.daysDiff(today, dueDate);

        const triggers = this.ruleTriggersToday(rule, diffDays);
        if (!triggers) {
          skipped++;
          continue;
        }

        await this.sendReminder({
          tenantId,
          invoice,
          rule,
          ownerEmail,
          daysOverdue: diffDays > 0 ? diffDays : 0,
          daysUntilDue: diffDays < 0 ? Math.abs(diffDays) : 0,
        });

        sent++;
      }
    }

    return { sent, skipped };
  }

  // ─── Send a single reminder ──────────────────────────────────────────────────

  private async sendReminder(opts: {
    tenantId: string;
    invoice: any;
    rule: any;
    ownerEmail: string;
    daysOverdue: number;
    daysUntilDue: number;
  }): Promise<void> {
    const { tenantId, invoice, rule, ownerEmail, daysOverdue, daysUntilDue } =
      opts;
    const amountOutstanding = Math.max(
      0,
      Number(invoice.totalAmount) - Number(invoice.amountPaid),
    );

    try {
      this.emailService.sendPaymentReminder({
        to: ownerEmail,
        invoiceIrn: invoice.firsConfirmedIrn ?? invoice.platformIrn,
        invoiceId: invoice.id,
        buyerName: invoice.buyerName,
        totalAmount: Number(invoice.totalAmount),
        amountOutstanding,
        currency: invoice.currency ?? 'NGN',
        dueDate: invoice.paymentDueDate!,
        daysOverdue,
        daysUntilDue,
        customMessage: rule.reminderMessage ?? undefined,
      });

      const [log] = await this.prisma.asAdmin((tx) =>
        Promise.all([
          tx.reminderLog.create({
            data: {
              invoiceId: invoice.id,
              tenantId,
              ruleId: rule.id,
              emailSentTo: ownerEmail,
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

      this.eventEmitter.emit('invoice.reminder_sent', {
        tenantId,
        eventType: 'invoice.reminder_sent',
        invoiceId: invoice.id,
        platformIrn: invoice.platformIrn,
        data: {
          invoiceId: invoice.id,
          platformIrn: invoice.platformIrn,
          ruleId: rule.id,
          ruleName: rule.name,
          emailSentTo: ownerEmail,
          amountOutstanding,
          daysOverdue,
          daysUntilDue,
        },
      });

      this.activityService.track({
        tenantId,
        eventType: 'REMINDER_SENT',
        actor: 'system',
        entityType: 'Invoice',
        entityId: invoice.id,
        payload: {
          ruleId: rule.id,
          ruleName: rule.name,
          logId: log.id,
          emailSentTo: ownerEmail,
          amountOutstanding,
        },
      });

      this.logger.log(
        `Reminder sent — invoice ${invoice.platformIrn} / rule "${rule.name}" / to ${ownerEmail}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send reminder for invoice ${invoice.id} rule ${rule.id}: ${err.message}`,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private ruleTriggersToday(rule: any, diffDays: number): boolean {
    switch (rule.triggerType as ReminderTriggerType) {
      case 'DAYS_BEFORE_DUE':
        return diffDays === -rule.triggerDays;
      case 'ON_DUE_DATE':
        return diffDays === 0;
      case 'DAYS_AFTER_DUE':
        return diffDays === rule.triggerDays;
    }
  }

  private daysDiff(today: Date, dueDate: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.round((today.getTime() - dueDate.getTime()) / msPerDay);
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private async getOwnerEmail(tenantId: string): Promise<string | null> {
    const ownerRole = await this.prisma.asAdmin((tx) =>
      tx.userRole.findFirst({
        where: { tenantId, role: 'OWNER' },
        include: { user: { select: { email: true, isActive: true } } },
      }),
    );

    if (!ownerRole?.user?.isActive) return null;
    return ownerRole.user.email;
  }

  private async findRuleOrThrow(tenantId: string, ruleId: string) {
    const rule = await this.prisma.asAdmin((tx) =>
      tx.reminderRule.findUnique({ where: { id: ruleId } }),
    );

    if (!rule) throw new NotFoundException(`Reminder rule ${ruleId} not found`);
    if (rule.tenantId !== tenantId) throw new ForbiddenException();

    return rule;
  }

  private validateTriggerType(triggerType: string): void {
    if (!VALID_TRIGGER_TYPES.includes(triggerType as ReminderTriggerType)) {
      throw new BadRequestException(
        `triggerType must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
      );
    }
  }

  private validateTriggerDays(
    triggerType: ReminderTriggerType,
    triggerDays: number,
  ): void {
    if (
      typeof triggerDays !== 'number' ||
      !Number.isInteger(triggerDays) ||
      triggerDays < 0
    ) {
      throw new BadRequestException(
        'triggerDays must be a non-negative integer',
      );
    }
    if (triggerType === 'ON_DUE_DATE' && triggerDays !== 0) {
      throw new BadRequestException(
        'triggerDays must be 0 for ON_DUE_DATE rules',
      );
    }
    if (triggerType !== 'ON_DUE_DATE' && triggerDays === 0) {
      throw new BadRequestException(
        'triggerDays must be > 0 for DAYS_BEFORE_DUE and DAYS_AFTER_DUE rules',
      );
    }
  }

  private mapRule(rule: any) {
    return {
      id: rule.id,
      tenantId: rule.tenantId,
      name: rule.name,
      triggerType: rule.triggerType,
      triggerDays: rule.triggerDays,
      isActive: rule.isActive,
      reminderMessage: rule.reminderMessage ?? null,
      createdAt:
        rule.createdAt instanceof Date
          ? rule.createdAt.toISOString()
          : rule.createdAt,
      updatedAt:
        rule.updatedAt instanceof Date
          ? rule.updatedAt.toISOString()
          : rule.updatedAt,
    };
  }
}
