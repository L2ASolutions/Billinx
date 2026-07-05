/// <reference types="jest" />

import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ReminderService } from './reminder.service';

const TENANT_ID = 'tenant-001';
const FIXED_NOW = new Date('2026-03-15T12:00:00.000Z');

function makeRuleRow(overrides: Record<string, any> = {}) {
  return {
    id: 'rule-1',
    tenantId: TENANT_ID,
    name: '3 days before due',
    triggerType: 'DAYS_BEFORE_DUE',
    triggerDays: 3,
    isActive: true,
    reminderMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeInvoiceRow(overrides: Record<string, any> = {}) {
  return {
    id: 'invoice-1',
    tenantId: TENANT_ID,
    platformIrn: 'IRN-1',
    firsConfirmedIrn: 'FIRS-IRN-1',
    buyerName: 'Buyer Ltd',
    totalAmount: 1000,
    amountPaid: 0,
    paymentDueDate: new Date('2026-03-18T00:00:00.000Z'),
    currency: 'NGN',
    reminderCount: 0,
    reminderLogs: [],
    ...overrides,
  };
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    reminderRule: {
      createMany: jest.fn().mockResolvedValue({ count: 5 }),
      findMany: jest.fn().mockResolvedValue([makeRuleRow()]),
      create: jest.fn().mockResolvedValue(makeRuleRow()),
      update: jest.fn().mockResolvedValue(makeRuleRow()),
      delete: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(makeRuleRow()),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([{ id: TENANT_ID }]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([makeInvoiceRow()]),
      update: jest.fn().mockResolvedValue({}),
    },
    userRole: {
      findFirst: jest.fn().mockResolvedValue({
        user: { email: 'owner@acme.com', isActive: true },
      }),
    },
    reminderLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    ...overrides,
  };
}

describe('ReminderService', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: { asAdmin: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let activityService: { track: jest.Mock };
  let emailService: { sendPaymentReminder: jest.Mock };
  let service: ReminderService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);

    tx = makeTx();
    prisma = { asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    eventEmitter = { emit: jest.fn() };
    activityService = { track: jest.fn() };
    emailService = { sendPaymentReminder: jest.fn() };
    service = new ReminderService(
      prisma as any,
      eventEmitter as any,
      activityService as any,
      emailService as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createDefaultRules', () => {
    it('creates all 5 default rules scoped to the tenant, skipping duplicates', async () => {
      await service.createDefaultRules(TENANT_ID);

      expect(tx.reminderRule.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            tenantId: TENANT_ID,
            triggerType: 'ON_DUE_DATE',
            triggerDays: 0,
          }),
          expect.objectContaining({
            tenantId: TENANT_ID,
            triggerType: 'DAYS_BEFORE_DUE',
            triggerDays: 3,
          }),
        ]),
        skipDuplicates: true,
      });
      expect(tx.reminderRule.createMany.mock.calls[0][0].data).toHaveLength(5);
    });
  });

  describe('listRules', () => {
    it('maps rules ordered by triggerType then triggerDays', async () => {
      const result = await service.listRules(TENANT_ID);
      expect(tx.reminderRule.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: [{ triggerType: 'asc' }, { triggerDays: 'asc' }],
      });
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('rule-1');
    });
  });

  describe('createRule', () => {
    it('rejects an invalid triggerType', async () => {
      await expect(
        service.createRule(TENANT_ID, {
          name: 'Bad',
          triggerType: 'INVALID',
          triggerDays: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative triggerDays', async () => {
      await expect(
        service.createRule(TENANT_ID, {
          name: 'Bad',
          triggerType: 'DAYS_AFTER_DUE',
          triggerDays: -1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-integer triggerDays', async () => {
      await expect(
        service.createRule(TENANT_ID, {
          name: 'Bad',
          triggerType: 'DAYS_AFTER_DUE',
          triggerDays: 1.5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects triggerDays !== 0 for ON_DUE_DATE', async () => {
      await expect(
        service.createRule(TENANT_ID, {
          name: 'Bad',
          triggerType: 'ON_DUE_DATE',
          triggerDays: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects triggerDays === 0 for non-ON_DUE_DATE types', async () => {
      await expect(
        service.createRule(TENANT_ID, {
          name: 'Bad',
          triggerType: 'DAYS_BEFORE_DUE',
          triggerDays: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('trims name/reminderMessage and creates the rule', async () => {
      await service.createRule(TENANT_ID, {
        name: '  Custom Rule  ',
        triggerType: 'DAYS_AFTER_DUE',
        triggerDays: 10,
        reminderMessage: '  Please pay  ',
      });

      expect(tx.reminderRule.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'Custom Rule',
          triggerType: 'DAYS_AFTER_DUE',
          triggerDays: 10,
          reminderMessage: 'Please pay',
        },
      });
    });
  });

  describe('updateRule', () => {
    it('throws NotFoundException when the rule does not exist', async () => {
      tx.reminderRule.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRule(TENANT_ID, 'missing', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the rule belongs to a different tenant', async () => {
      tx.reminderRule.findUnique.mockResolvedValue(
        makeRuleRow({ tenantId: 'other-tenant' }),
      );
      await expect(
        service.updateRule(TENANT_ID, 'rule-1', { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('validates triggerDays against the existing triggerType when triggerType is not in the patch', async () => {
      tx.reminderRule.findUnique.mockResolvedValue(
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      );
      await expect(
        service.updateRule(TENANT_ID, 'rule-1', { triggerDays: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('only includes fields present in the patch (partial update)', async () => {
      await service.updateRule(TENANT_ID, 'rule-1', { isActive: false });
      expect(tx.reminderRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { isActive: false },
      });
    });
  });

  describe('deleteRule', () => {
    it('throws NotFoundException when the rule does not exist', async () => {
      tx.reminderRule.findUnique.mockResolvedValue(null);
      await expect(service.deleteRule(TENANT_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the rule belongs to a different tenant', async () => {
      tx.reminderRule.findUnique.mockResolvedValue(
        makeRuleRow({ tenantId: 'other-tenant' }),
      );
      await expect(service.deleteRule(TENANT_ID, 'rule-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deletes the rule once ownership is confirmed', async () => {
      await service.deleteRule(TENANT_ID, 'rule-1');
      expect(tx.reminderRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
      });
    });
  });

  describe('runDailyReminderCheck (cron entrypoint)', () => {
    it('delegates to runReminderCheck', async () => {
      const spy = jest.spyOn(service, 'runReminderCheck').mockResolvedValue({
        processed: 0,
        sent: 0,
        skipped: 0,
      });
      await service.runDailyReminderCheck();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('runReminderCheck', () => {
    it('scopes to a single tenant when targetTenantId is given, otherwise all active tenants', async () => {
      await service.runReminderCheck('specific-tenant');
      expect(tx.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'specific-tenant' } }),
      );

      await service.runReminderCheck();
      expect(tx.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('skips a tenant entirely (0 sent/skipped) when there is no active OWNER email', async () => {
      tx.userRole.findFirst.mockResolvedValue(null);
      const result = await service.runReminderCheck();
      expect(result).toEqual({ processed: 1, sent: 0, skipped: 0 });
      expect(emailService.sendPaymentReminder).not.toHaveBeenCalled();
    });

    it('skips a tenant when the owner user is inactive', async () => {
      tx.userRole.findFirst.mockResolvedValue({
        user: { email: 'owner@acme.com', isActive: false },
      });
      const result = await service.runReminderCheck();
      expect(result.sent).toBe(0);
    });

    it('skips a tenant with no active reminder rules', async () => {
      tx.reminderRule.findMany.mockResolvedValue([]);
      const result = await service.runReminderCheck();
      expect(result.sent).toBe(0);
    });

    it('skips a tenant with no qualifying invoices', async () => {
      tx.invoice.findMany.mockResolvedValue([]);
      const result = await service.runReminderCheck();
      expect(result.sent).toBe(0);
    });

    it('does not resend a reminder already logged for that rule (dedup)', async () => {
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({ reminderLogs: [{ ruleId: 'rule-1' }] }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.skipped).toBe(1);
      expect(result.sent).toBe(0);
      expect(emailService.sendPaymentReminder).not.toHaveBeenCalled();
    });

    it('fires a DAYS_BEFORE_DUE reminder exactly N days before the due date', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'DAYS_BEFORE_DUE', triggerDays: 3 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-18T00:00:00.000Z'),
        }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.sent).toBe(1);
      expect(emailService.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({ daysUntilDue: 3, daysOverdue: 0 }),
      );
    });

    it('fires an ON_DUE_DATE reminder exactly on the due date', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
        }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.sent).toBe(1);
      expect(emailService.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({ daysUntilDue: 0, daysOverdue: 0 }),
      );
    });

    it('fires a DAYS_AFTER_DUE reminder exactly N days after the due date', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'DAYS_AFTER_DUE', triggerDays: 7 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-08T00:00:00.000Z'),
        }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.sent).toBe(1);
      expect(emailService.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({ daysOverdue: 7, daysUntilDue: 0 }),
      );
    });

    it('does not fire when the day does not match the rule trigger', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'DAYS_BEFORE_DUE', triggerDays: 3 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-20T00:00:00.000Z'),
        }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('on a successful send: logs the reminder, increments the invoice counter, emits an event, and tracks activity', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
          totalAmount: 1000,
          amountPaid: 200,
        }),
      ]);

      await service.runReminderCheck();

      expect(tx.reminderLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceId: 'invoice-1',
          tenantId: TENANT_ID,
          ruleId: 'rule-1',
          emailSentTo: 'owner@acme.com',
        }),
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          reminderCount: { increment: 1 },
          lastReminderAt: expect.any(Date),
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'invoice.reminder_sent',
        expect.objectContaining({
          tenantId: TENANT_ID,
          invoiceId: 'invoice-1',
        }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          eventType: 'REMINDER_SENT',
          actor: 'system',
          entityId: 'invoice-1',
        }),
      );
    });

    it('floors amountOutstanding at 0 even if amountPaid exceeds totalAmount', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
          totalAmount: 1000,
          amountPaid: 1500,
        }),
      ]);

      await service.runReminderCheck();

      expect(emailService.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({ amountOutstanding: 0 }),
      );
    });

    it('falls back to platformIrn when firsConfirmedIrn is absent', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
          firsConfirmedIrn: null,
        }),
      ]);

      await service.runReminderCheck();

      expect(emailService.sendPaymentReminder).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceIrn: 'IRN-1' }),
      );
    });

    it('does not propagate an error thrown by the email send (swallowed and logged)', async () => {
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
        }),
      ]);
      emailService.sendPaymentReminder.mockImplementation(() => {
        throw new Error('SES down');
      });

      await expect(service.runReminderCheck()).resolves.toBeDefined();
      expect(tx.reminderLog.create).not.toHaveBeenCalled();
    });

    it('aggregates processed/sent/skipped across multiple tenants', async () => {
      tx.tenant.findMany.mockResolvedValue([
        { id: 'tenant-a' },
        { id: 'tenant-b' },
      ]);
      tx.reminderRule.findMany.mockResolvedValue([
        makeRuleRow({ triggerType: 'ON_DUE_DATE', triggerDays: 0 }),
      ]);
      tx.invoice.findMany.mockResolvedValue([
        makeInvoiceRow({
          paymentDueDate: new Date('2026-03-15T00:00:00.000Z'),
        }),
      ]);

      const result = await service.runReminderCheck();
      expect(result.processed).toBe(2);
      expect(result.sent).toBe(2);
    });
  });
});
