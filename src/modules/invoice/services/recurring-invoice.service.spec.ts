/// <reference types="jest" />

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';

jest.mock('../../../shared/context/request-context', () => ({
  runWithContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

const TENANT_ID = 'tenant-001';

function makeLineItem(overrides: Record<string, any> = {}): any {
  return {
    description: 'Retainer fee',
    quantity: 1,
    unitPrice: 100000,
    vatRate: 7.5,
    itemType: 'product',
    hsnCode: '8471',
    productCategory: 'Software services',
    priceUnit: 'EA',
    ...overrides,
  };
}

function makeTemplateData(overrides: Record<string, any> = {}): any {
  return {
    invoiceKind: 'B2B',
    invoiceTypeCode: '381',
    currency: 'NGN',
    notes: 'Monthly retainer',
    buyer: { name: 'Acme Ltd', tin: '87654321-0001', email: 'buyer@acme.com' },
    lineItems: [makeLineItem()],
    ...overrides,
  };
}

function makeScheduleRow(overrides: Record<string, any> = {}): any {
  return {
    id: 'sched-1',
    tenantId: TENANT_ID,
    name: 'Monthly retainer - Acme Ltd',
    frequency: 'MONTHLY',
    startDate: new Date('2026-01-31T00:00:00.000Z'),
    endDate: null,
    nextRunDate: new Date('2026-01-31T00:00:00.000Z'),
    status: 'ACTIVE',
    autoSubmit: false,
    autoSend: false,
    templateData: makeTemplateData(),
    lastRunAt: null,
    invoiceCount: 0,
    ...overrides,
  };
}

describe('RecurringInvoiceService', () => {
  let tx: any;
  let prisma: { asAdmin: jest.Mock; invoice: { update: jest.Mock } };
  let invoiceService: {
    normaliseLineItems: jest.Mock;
    saveDraftInvoice: jest.Mock;
    submitDraft: jest.Mock;
    sendToBuyer: jest.Mock;
  };
  let validationService: { validateInvoiceFields: jest.Mock };
  let notificationService: { create: jest.Mock };
  let service: RecurringInvoiceService;

  beforeEach(() => {
    tx = {
      recurringInvoice: {
        create: jest.fn().mockResolvedValue(makeScheduleRow()),
        findMany: jest.fn().mockResolvedValue([makeScheduleRow()]),
        findUnique: jest.fn().mockResolvedValue(makeScheduleRow()),
        update: jest.fn().mockResolvedValue(makeScheduleRow()),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          tin: '12345678-0001',
          name: 'Seller Co',
          registeredAddress: { streetName: 'Main St', country: 'NG' },
          environment: 'SANDBOX',
          isActive: true,
        }),
      },
      userRole: {
        findFirst: jest.fn().mockResolvedValue({
          user: { id: 'user-1', isActive: true },
        }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inv-1',
          tenantId: TENANT_ID,
          platformIrn: 'IRN-1',
          recurringInvoiceId: 'sched-1',
        }),
      },
    };

    prisma = {
      asAdmin: jest.fn((fn: any) => fn(tx)),
      invoice: { update: jest.fn().mockResolvedValue({}) },
    };

    invoiceService = {
      normaliseLineItems: jest.fn((items: any[]) => items),
      saveDraftInvoice: jest.fn().mockResolvedValue({
        id: 'inv-1',
        platformIrn: 'IRN-1',
        status: 'DRAFT',
      }),
      submitDraft: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', status: 'QUEUED' }),
      sendToBuyer: jest.fn().mockResolvedValue({ sent: true }),
    };

    validationService = {
      validateInvoiceFields: jest
        .fn()
        .mockReturnValue({ valid: true, errors: [], warnings: [] }),
    };

    notificationService = { create: jest.fn().mockResolvedValue({}) };

    service = new RecurringInvoiceService(
      prisma as any,
      invoiceService as any,
      validationService as any,
      notificationService as any,
    );
  });

  // ── calculateNextRunDate ────────────────────────────────────────────────

  describe('calculateNextRunDate', () => {
    it('adds 7 days for WEEKLY', () => {
      const next = service.calculateNextRunDate(
        new Date('2026-03-01T00:00:00.000Z'),
        'WEEKLY',
      );
      expect(next.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    });

    it('adds 1 calendar month for MONTHLY, same day', () => {
      const next = service.calculateNextRunDate(
        new Date('2026-03-15T00:00:00.000Z'),
        'MONTHLY',
      );
      expect(next.toISOString()).toBe('2026-04-15T00:00:00.000Z');
    });

    it('clamps MONTHLY to the last day of a shorter target month', () => {
      const next = service.calculateNextRunDate(
        new Date('2026-01-31T00:00:00.000Z'),
        'MONTHLY',
      );
      expect(next.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    });

    it('clamps MONTHLY to Feb 29 in a leap year', () => {
      const next = service.calculateNextRunDate(
        new Date('2027-01-31T00:00:00.000Z'),
        'MONTHLY',
      );
      // 2028 is a leap year
      const next2 = service.calculateNextRunDate(
        new Date('2028-01-31T00:00:00.000Z'),
        'MONTHLY',
      );
      expect(next.toISOString()).toBe('2027-02-28T00:00:00.000Z');
      expect(next2.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it('adds 3 calendar months for QUARTERLY', () => {
      const next = service.calculateNextRunDate(
        new Date('2026-01-31T00:00:00.000Z'),
        'QUARTERLY',
      );
      expect(next.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    });

    it('adds 1 year for ANNUALLY, clamping Feb 29 in a non-leap target year', () => {
      const next = service.calculateNextRunDate(
        new Date('2028-02-29T00:00:00.000Z'),
        'ANNUALLY',
      );
      expect(next.toISOString()).toBe('2029-02-28T00:00:00.000Z');
    });

    it('rejects an unrecognised frequency', () => {
      expect(() =>
        service.calculateNextRunDate(new Date(), 'DAILY' as any),
      ).toThrow(BadRequestException);
    });
  });

  // ── createSchedule ──────────────────────────────────────────────────────

  describe('createSchedule', () => {
    const baseDto = {
      name: 'Monthly retainer - Acme Ltd',
      frequency: 'MONTHLY' as const,
      startDate: '2026-02-01',
      templateData: makeTemplateData(),
    };

    it('creates a schedule with nextRunDate seeded from startDate', async () => {
      await service.createSchedule(TENANT_ID, baseDto);

      expect(tx.recurringInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: baseDto.name,
            nextRunDate: new Date('2026-02-01'),
            autoSubmit: false,
            autoSend: false,
          }),
        }),
      );
    });

    it('rejects a missing name', async () => {
      await expect(
        service.createSchedule(TENANT_ID, { ...baseDto, name: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid frequency', async () => {
      await expect(
        service.createSchedule(TENANT_ID, {
          ...baseDto,
          frequency: 'DAILY' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects templateData with no buyer name', async () => {
      await expect(
        service.createSchedule(TENANT_ID, {
          ...baseDto,
          templateData: makeTemplateData({ buyer: { name: '' } }),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects templateData with no line items', async () => {
      await expect(
        service.createSchedule(TENANT_ID, {
          ...baseDto,
          templateData: makeTemplateData({ lineItems: [] }),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects endDate before startDate', async () => {
      await expect(
        service.createSchedule(TENANT_ID, {
          ...baseDto,
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs pre-flight VALIDATE-context validation when autoSubmit is true', async () => {
      await service.createSchedule(TENANT_ID, { ...baseDto, autoSubmit: true });

      expect(validationService.validateInvoiceFields).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceKind: 'B2B' }),
        'VALIDATE',
      );
    });

    it('throws when autoSubmit template fails pre-flight validation', async () => {
      validationService.validateInvoiceFields.mockReturnValue({
        valid: false,
        errors: [
          {
            field: 'lineItems',
            code: 'MISSING_PRODUCT_CLASSIFICATION',
            message: 'x',
            severity: 'ERROR',
          },
        ],
        warnings: [],
      });

      await expect(
        service.createSchedule(TENANT_ID, { ...baseDto, autoSubmit: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not run pre-flight validation when autoSubmit is false', async () => {
      await service.createSchedule(TENANT_ID, baseDto);
      expect(validationService.validateInvoiceFields).not.toHaveBeenCalled();
    });
  });

  // ── list / get ──────────────────────────────────────────────────────────

  describe('listSchedules / getSchedule', () => {
    it('lists schedules scoped to the tenant', async () => {
      await service.listSchedules(TENANT_ID);
      expect(tx.recurringInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('returns a schedule belonging to the tenant', async () => {
      const result = await service.getSchedule(TENANT_ID, 'sched-1');
      expect(result).toBeDefined();
    });

    it('throws 404 for a schedule belonging to another tenant', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ tenantId: 'other-tenant' }),
      );
      await expect(service.getSchedule(TENANT_ID, 'sched-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when the schedule does not exist', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(null);
      await expect(service.getSchedule(TENANT_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateSchedule ──────────────────────────────────────────────────────

  describe('updateSchedule', () => {
    it('re-anchors nextRunDate when startDate changes and no invoices have run yet', async () => {
      await service.updateSchedule(TENANT_ID, 'sched-1', {
        startDate: '2026-03-01',
      });

      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextRunDate: new Date('2026-03-01'),
          }),
        }),
      );
    });

    it('does not re-anchor nextRunDate once invoices have already run', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ invoiceCount: 3 }),
      );

      await service.updateSchedule(TENANT_ID, 'sched-1', {
        startDate: '2026-03-01',
      });

      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextRunDate: makeScheduleRow().nextRunDate,
          }),
        }),
      );
    });

    it('re-validates the merged template when autoSubmit is (or becomes) true', async () => {
      await service.updateSchedule(TENANT_ID, 'sched-1', { autoSubmit: true });
      expect(validationService.validateInvoiceFields).toHaveBeenCalled();
    });
  });

  // ── pause / resume / cancel ─────────────────────────────────────────────

  describe('pauseSchedule', () => {
    it('pauses an ACTIVE schedule', async () => {
      await service.pauseSchedule(TENANT_ID, 'sched-1');
      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PAUSED' } }),
      );
    });

    it('rejects pausing a non-ACTIVE schedule', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ status: 'PAUSED' }),
      );
      await expect(service.pauseSchedule(TENANT_ID, 'sched-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resumeSchedule', () => {
    it('rejects resuming a non-PAUSED schedule', async () => {
      await expect(
        service.resumeSchedule(TENANT_ID, 'sched-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('catches nextRunDate up to today without re-anchoring to a single missed date', async () => {
      const realDateNow = Date.now;
      Date.now = jest.fn(() => new Date('2026-05-01T00:00:00.000Z').getTime());

      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({
          status: 'PAUSED',
          frequency: 'MONTHLY',
          nextRunDate: new Date('2026-01-31T00:00:00.000Z'),
        }),
      );

      await service.resumeSchedule(TENANT_ID, 'sched-1');

      const call = tx.recurringInvoice.update.mock.calls[0][0];
      expect(call.data.status).toBe('ACTIVE');
      expect(call.data.nextRunDate.getTime()).toBeGreaterThan(
        new Date('2026-05-01T00:00:00.000Z').getTime(),
      );

      Date.now = realDateNow;
    });
  });

  describe('cancelSchedule', () => {
    it('cancels an active schedule', async () => {
      await service.cancelSchedule(TENANT_ID, 'sched-1');
      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('is a no-op (no update call) for an already-cancelled schedule', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ status: 'CANCELLED' }),
      );
      await service.cancelSchedule(TENANT_ID, 'sched-1');
      expect(tx.recurringInvoice.update).not.toHaveBeenCalled();
    });
  });

  // ── processSchedule ─────────────────────────────────────────────────────

  describe('processSchedule', () => {
    it('creates a DRAFT invoice via saveDraftInvoice and links it to the schedule', async () => {
      const schedule = makeScheduleRow();
      await service.processSchedule(schedule);

      expect(invoiceService.saveDraftInvoice).toHaveBeenCalledWith(
        TENANT_ID,
        'SANDBOX',
        'system:recurring-invoice',
        expect.objectContaining({
          invoiceKind: 'B2B',
          seller: expect.objectContaining({ tin: '12345678-0001' }),
          buyer: expect.objectContaining({ partyName: 'Acme Ltd' }),
        }),
      );
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { recurringInvoiceId: 'sched-1' },
      });
    });

    it('does not call submitDraft when autoSubmit is false', async () => {
      await service.processSchedule(makeScheduleRow({ autoSubmit: false }));
      expect(invoiceService.submitDraft).not.toHaveBeenCalled();
    });

    it('calls submitDraft with the same seller/buyer as saveDraftInvoice, not an empty body', async () => {
      // Regression test: submitDraft()'s own metadata merge is
      // `sellerParty: request.seller ?? null` with no fallback to the
      // invoice's existing value, so an empty body here would silently null
      // out the sellerParty/buyerParty metadata saveDraftInvoice() just set
      // (breaking sendToBuyer()'s buyerParty.email fallback for autoSend).
      await service.processSchedule(makeScheduleRow({ autoSubmit: true }));
      expect(invoiceService.submitDraft).toHaveBeenCalledWith(
        'inv-1',
        TENANT_ID,
        'system:recurring-invoice',
        {
          seller: expect.objectContaining({ tin: '12345678-0001' }),
          buyer: expect.objectContaining({ partyName: 'Acme Ltd' }),
        },
      );
    });

    it('never calls sendToBuyer synchronously, even when autoSend is true', async () => {
      await service.processSchedule(makeScheduleRow({ autoSend: true }));
      expect(invoiceService.sendToBuyer).not.toHaveBeenCalled();
    });

    it('leaves the invoice as DRAFT and notifies the tenant when autoSubmit validation fails', async () => {
      invoiceService.submitDraft.mockRejectedValue(
        new BadRequestException('At least one line item is required'),
      );

      await service.processSchedule(makeScheduleRow({ autoSubmit: true }));

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          type: 'recurring_auto_submit_failed',
        }),
      );
    });

    it('advances nextRunDate and increments invoiceCount after a run', async () => {
      const schedule = makeScheduleRow({
        nextRunDate: new Date('2026-01-31T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      await service.processSchedule(schedule);

      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sched-1' },
          data: expect.objectContaining({
            invoiceCount: { increment: 1 },
            nextRunDate: new Date('2026-02-28T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('marks the schedule COMPLETED when the next run would be past endDate', async () => {
      const schedule = makeScheduleRow({
        nextRunDate: new Date('2026-01-31T00:00:00.000Z'),
        frequency: 'MONTHLY',
        endDate: new Date('2026-02-01T00:00:00.000Z'),
      });
      await service.processSchedule(schedule);

      expect(tx.recurringInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('throws without creating an invoice when the tenant is inactive', async () => {
      tx.tenant.findUnique.mockResolvedValue({
        tin: '1',
        name: 'X',
        registeredAddress: {},
        environment: 'SANDBOX',
        isActive: false,
      });

      await expect(
        service.processSchedule(makeScheduleRow()),
      ).rejects.toThrow();
      expect(invoiceService.saveDraftInvoice).not.toHaveBeenCalled();
    });
  });

  // ── runDueSchedules ─────────────────────────────────────────────────────

  describe('runDueSchedules', () => {
    it('isolates a failing schedule so it does not block the others', async () => {
      const good = makeScheduleRow({ id: 'sched-good' });
      const bad = makeScheduleRow({ id: 'sched-bad' });
      tx.recurringInvoice.findMany.mockResolvedValue([bad, good]);

      let calls = 0;
      invoiceService.saveDraftInvoice.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({
          id: 'inv-1',
          platformIrn: 'IRN-1',
          status: 'DRAFT',
        });
      });

      const result = await service.runDueSchedules();

      expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
    });

    it('queries only ACTIVE schedules due on or before now', async () => {
      await service.runDueSchedules();
      expect(tx.recurringInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });
  });

  // ── event handlers ──────────────────────────────────────────────────────

  describe('onInvoiceAccepted', () => {
    it('sends to buyer when the accepted invoice belongs to an autoSend schedule', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ autoSend: true }),
      );

      await service.onInvoiceAccepted({
        tenantId: TENANT_ID,
        data: { invoiceId: 'inv-1' },
      });

      expect(invoiceService.sendToBuyer).toHaveBeenCalledWith(
        'inv-1',
        TENANT_ID,
      );
    });

    it('does not send when the schedule has autoSend disabled', async () => {
      tx.recurringInvoice.findUnique.mockResolvedValue(
        makeScheduleRow({ autoSend: false }),
      );

      await service.onInvoiceAccepted({
        tenantId: TENANT_ID,
        data: { invoiceId: 'inv-1' },
      });

      expect(invoiceService.sendToBuyer).not.toHaveBeenCalled();
    });

    it('no-ops for an invoice with no recurringInvoiceId', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        id: 'inv-2',
        tenantId: TENANT_ID,
        recurringInvoiceId: null,
      });

      await service.onInvoiceAccepted({
        tenantId: TENANT_ID,
        data: { invoiceId: 'inv-2' },
      });

      expect(invoiceService.sendToBuyer).not.toHaveBeenCalled();
    });
  });

  describe('onInvoiceRejected', () => {
    it('notifies the tenant when a recurring-generated invoice is rejected', async () => {
      await service.onInvoiceRejected({
        tenantId: TENANT_ID,
        data: { invoiceId: 'inv-1', errorMessage: 'Invalid TIN' },
      });

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          type: 'recurring_auto_submit_rejected',
        }),
      );
    });

    it('no-ops for a non-recurring invoice', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        id: 'inv-3',
        tenantId: TENANT_ID,
        recurringInvoiceId: null,
      });

      await service.onInvoiceRejected({
        tenantId: TENANT_ID,
        data: { invoiceId: 'inv-3' },
      });

      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });
});
