/// <reference types="jest" />

/**
 * Integration tests for the invoice submission flow.
 *
 * These tests exercise SubmissionService with mocked Prisma, adapters, and
 * queue boundary so we can verify state transitions and event emissions without
 * a real database or FIRS connection.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { SubmissionService } from '../../submission/services/submission.service';
import { MockAdapter } from '../../submission/adapters/mock/mock.adapter';
import { InterswitchAdapter } from '../../submission/adapters/interswitch/interswitch.adapter';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ActivityService } from '../../activity/services/activity.service';
import { SubmissionResult } from '../../../../packages/types/submission';
import { RecoveryService } from '../../../shared/recovery/recovery.service';
import { InvoiceService } from './invoice.service';

// ── Mock BullMQ queue so tests never hit Redis ────────────────────────────────
jest.mock('../../submission/queues/submission.queue', () => ({
  addToSubmissionQueue: jest.fn().mockResolvedValue(undefined),
  QUEUE_NAME: 'invoice-submission',
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Record<string, any> = {}): any {
  return {
    id: 'invoice-uuid-001',
    tenantId: 'tenant-uuid-001',
    platformIrn: 'INV001-TEST-001',
    status: 'QUEUED',
    lineItems: [],
    taxTotal: [],
    legalMonetaryTotal: { payableAmount: 107500 },
    metadata: {},
    ...overrides,
  };
}

function makeJobData(overrides: Record<string, any> = {}): any {
  return {
    invoiceId: 'invoice-uuid-001',
    tenantId: 'tenant-uuid-001',
    platformIrn: 'INV001-TEST-001',
    adapterKey: 'mock',
    attempt: 1,
    ...overrides,
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makePrismaMock(
  invoiceData: any = makeInvoice(),
  onInvoiceUpdate?: (data: any) => void,
) {
  return {
    asAdmin: jest.fn((fn: (tx: any) => Promise<any>) => {
      const tx: any = {
        invoice: {
          findUnique: jest.fn().mockResolvedValue(invoiceData),
          update: jest.fn().mockImplementation(({ data }: any) => {
            onInvoiceUpdate?.(data);
            return Promise.resolve({ ...invoiceData, ...data });
          }),
        },
        invoiceStateHistory: { create: jest.fn().mockResolvedValue({}) },
        submissionAttempt: {
          create: jest.fn().mockResolvedValue({ id: 'attempt-001' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    }),
  };
}

function makeAdapterMock(result: SubmissionResult): MockAdapter {
  return {
    adapterKey: 'mock',
    adapterName: 'Mock',
    submit: jest.fn().mockResolvedValue(result),
  } as any;
}

async function buildService(
  adapterResult: SubmissionResult,
  invoiceData?: any,
  onInvoiceUpdate?: (data: any) => void,
): Promise<{
  service: SubmissionService;
  events: EventEmitter2;
  activity: jest.Mock;
}> {
  const prismaMock = makePrismaMock(
    invoiceData ?? makeInvoice(),
    onInvoiceUpdate,
  );
  const adapterMock = makeAdapterMock(adapterResult);
  const activityTrack = jest.fn();

  const module: TestingModule = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      SubmissionService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: ActivityService, useValue: { track: activityTrack } },
      { provide: MockAdapter, useValue: adapterMock },
      {
        provide: InterswitchAdapter,
        useValue: {
          adapterKey: 'interswitch',
          adapterName: 'Interswitch',
          submit: jest.fn(),
        },
      },
    ],
  }).compile();

  const service = module.get(SubmissionService);
  const events = module.get(EventEmitter2);

  return { service, events, activity: activityTrack };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Invoice submission flow — integration', () => {
  // ── Flow 1: FIRS accepts ─────────────────────────────────────────────────

  describe('Flow 1: create → queue → submit → ACCEPTED', () => {
    const acceptedResult: SubmissionResult = {
      success: true,
      firsConfirmedIrn: 'FIRS-CONFIRMED-001',
      qrCodeBase64: 'base64qrdata==',
      rawResponse: { status: 'ACCEPTED' },
    };

    it('transitions invoice through SUBMITTING → ACCEPTED', async () => {
      const statusUpdates: string[] = [];
      const { service } = await buildService(
        acceptedResult,
        makeInvoice(),
        (data) => {
          if (data.status) statusUpdates.push(data.status);
        },
      );

      await service.processSubmission(makeJobData());

      expect(statusUpdates).toContain('SUBMITTING');
      expect(statusUpdates).toContain('ACCEPTED');
    });

    it('stores firsConfirmedIrn on the invoice record', async () => {
      const updatedData: any[] = [];
      const { service } = await buildService(
        acceptedResult,
        makeInvoice(),
        (data) => updatedData.push(data),
      );

      await service.processSubmission(makeJobData());

      const acceptUpdate = updatedData.find((d) => d.firsConfirmedIrn);
      expect(acceptUpdate?.firsConfirmedIrn).toBe('FIRS-CONFIRMED-001');
    });

    it('emits invoice.accepted event with firsConfirmedIrn', async () => {
      const emitted: any[] = [];
      const { service, events } = await buildService(acceptedResult);
      events.on('invoice.accepted', (p) => emitted.push(p));

      await service.processSubmission(makeJobData());

      expect(emitted).toHaveLength(1);
      expect(emitted[0].data.firsConfirmedIrn).toBe('FIRS-CONFIRMED-001');
    });

    it('tracks INVOICE_ACCEPTED activity event', async () => {
      const { service, activity } = await buildService(acceptedResult);

      await service.processSubmission(makeJobData());

      expect(activity).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INVOICE_ACCEPTED' }),
      );
    });
  });

  // ── Flow 2: FIRS rejects with retryable error ────────────────────────────

  describe('Flow 2: create → queue → submit → SUBMISSION_FAILED (retryable)', () => {
    const retryableResult: SubmissionResult = {
      success: false,
      errorCode: 'FIRS-ERR-5000',
      errorMessage: 'Upstream FIRS timeout — retry',
      retryable: true,
    };

    it('sets status to SUBMISSION_FAILED (not DEAD_LETTERED) on attempt 1', async () => {
      const statusUpdates: string[] = [];
      const { service } = await buildService(
        retryableResult,
        makeInvoice(),
        (data) => {
          if (data.status) statusUpdates.push(data.status);
        },
      );

      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(statusUpdates).toContain('SUBMISSION_FAILED');
      expect(statusUpdates).not.toContain('DEAD_LETTERED');
      expect(statusUpdates).not.toContain('REJECTED');
    });

    it('does not emit invoice.accepted on retryable failure', async () => {
      const accepted: any[] = [];
      const { service, events } = await buildService(retryableResult);
      events.on('invoice.accepted', (p) => accepted.push(p));

      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(accepted).toHaveLength(0);
    });

    it('records errorCode in submission attempt', async () => {
      let attemptUpdateData: any;
      const prismaMock = {
        asAdmin: jest.fn((fn: (tx: any) => Promise<any>) => {
          const tx: any = {
            invoice: {
              findUnique: jest.fn().mockResolvedValue(makeInvoice()),
              update: jest.fn().mockResolvedValue(makeInvoice()),
            },
            invoiceStateHistory: { create: jest.fn().mockResolvedValue({}) },
            submissionAttempt: {
              create: jest.fn().mockResolvedValue({ id: 'attempt-001' }),
              update: jest.fn().mockImplementation(({ data }: any) => {
                attemptUpdateData = data;
                return Promise.resolve({});
              }),
            },
          };
          return fn(tx);
        }),
      };

      const module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          SubmissionService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: ActivityService, useValue: { track: jest.fn() } },
          { provide: MockAdapter, useValue: makeAdapterMock(retryableResult) },
          {
            provide: InterswitchAdapter,
            useValue: { adapterKey: 'interswitch', submit: jest.fn() },
          },
        ],
      }).compile();

      const service = module.get(SubmissionService);
      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(attemptUpdateData?.errorCode).toBe('FIRS-ERR-5000');
    });
  });

  // ── Flow 3: retries exhausted → DEAD_LETTERED ────────────────────────────

  describe('Flow 3: create → queue → submit × 3 → DEAD_LETTERED', () => {
    const retryableResult: SubmissionResult = {
      success: false,
      errorCode: 'FIRS-ERR-5000',
      errorMessage: 'Persistent upstream error',
      retryable: true,
    };

    it('sets status to DEAD_LETTERED on the 3rd (final) attempt', async () => {
      const statusUpdates: string[] = [];
      const { service } = await buildService(
        retryableResult,
        makeInvoice(),
        (data) => {
          if (data.status) statusUpdates.push(data.status);
        },
      );

      await service.processSubmission(makeJobData({ attempt: 3 }));

      expect(statusUpdates).toContain('DEAD_LETTERED');
    });

    it('never uses REJECTED status when retries are exhausted', async () => {
      const statusUpdates: string[] = [];
      const { service } = await buildService(
        retryableResult,
        makeInvoice(),
        (data) => {
          if (data.status) statusUpdates.push(data.status);
        },
      );

      await service.processSubmission(makeJobData({ attempt: 3 }));

      expect(statusUpdates).not.toContain('REJECTED');
    });

    it('sets DEAD_LETTERED immediately for non-retryable errors (regardless of attempt)', async () => {
      const nonRetryable: SubmissionResult = {
        success: false,
        errorCode: 'FIRS-ERR-4001',
        errorMessage: 'Invalid seller TIN — cannot retry',
        retryable: false,
      };

      const statusUpdates: string[] = [];
      const { service } = await buildService(
        nonRetryable,
        makeInvoice(),
        (data) => {
          if (data.status) statusUpdates.push(data.status);
        },
      );

      // Even on attempt 1, non-retryable → DEAD_LETTERED
      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(statusUpdates).toContain('DEAD_LETTERED');
      expect(statusUpdates).not.toContain('REJECTED');
    });
  });

  // ── Flow 3b: IRN duplicate → status check → ACCEPTED (not DEAD_LETTERED) ──

  describe('Flow 3b: IRN_DUPLICATE triggers status check, not immediate DEAD_LETTER', () => {
    it('calls checkStatus when adapter returns IRN_DUPLICATE', async () => {
      const irnDuplicateResult: SubmissionResult = {
        success: false,
        errorCode: 'IRN_DUPLICATE',
        errorMessage: 'IRN already exists in FIRS',
        retryable: false,
      };

      const checkStatusResult: SubmissionResult = {
        success: true,
        firsConfirmedIrn: 'FIRS-RECOVERED-001',
        qrCodeBase64: 'base64qr==',
        rawResponse: { status: 'ACCEPTED' },
      };

      const checkStatusMock = jest.fn().mockResolvedValue(checkStatusResult);
      const adapterWithCheck = {
        adapterKey: 'mock',
        adapterName: 'Mock with checkStatus',
        submit: jest.fn().mockResolvedValue(irnDuplicateResult),
        checkStatus: checkStatusMock,
      };

      const statusUpdates: string[] = [];
      const prismaMock = makePrismaMock(makeInvoice(), (data) => {
        if (data.status) statusUpdates.push(data.status);
      });

      const module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          SubmissionService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: ActivityService, useValue: { track: jest.fn() } },
          { provide: MockAdapter, useValue: adapterWithCheck },
          {
            provide: InterswitchAdapter,
            useValue: {
              adapterKey: 'interswitch',
              submit: jest.fn(),
              checkStatus: jest.fn(),
            },
          },
        ],
      }).compile();

      const service = module.get(SubmissionService);
      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(checkStatusMock).toHaveBeenCalledWith(
        'INV001-TEST-001',
        expect.objectContaining({ tenantId: 'tenant-uuid-001' }),
      );
      expect(statusUpdates).toContain('ACCEPTED');
      expect(statusUpdates).not.toContain('DEAD_LETTERED');
    });

    it('DEAD_LETTERs when checkStatus also fails after IRN_DUPLICATE', async () => {
      const irnDuplicateResult: SubmissionResult = {
        success: false,
        errorCode: 'IRN_DUPLICATE',
        errorMessage: 'IRN already exists in FIRS',
        retryable: false,
      };

      const checkStatusFailed: SubmissionResult = {
        success: false,
        errorCode: 'STATUS_CHECK_FAILED',
        errorMessage: 'FIRS status check returned 503',
        retryable: false,
      };

      const statusUpdates: string[] = [];
      const prismaMock = makePrismaMock(makeInvoice(), (data) => {
        if (data.status) statusUpdates.push(data.status);
      });

      const adapterCheckFails = {
        adapterKey: 'mock',
        adapterName: 'Mock check-fails',
        submit: jest.fn().mockResolvedValue(irnDuplicateResult),
        checkStatus: jest.fn().mockResolvedValue(checkStatusFailed),
      };

      const module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          SubmissionService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: ActivityService, useValue: { track: jest.fn() } },
          { provide: MockAdapter, useValue: adapterCheckFails },
          {
            provide: InterswitchAdapter,
            useValue: {
              adapterKey: 'interswitch',
              submit: jest.fn(),
              checkStatus: jest.fn(),
            },
          },
        ],
      }).compile();

      const service = module.get(SubmissionService);
      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(statusUpdates).toContain('DEAD_LETTERED');
      expect(statusUpdates).not.toContain('ACCEPTED');
    });
  });

  // ── Flow 4: adapter throws → treated as retryable ────────────────────────

  describe('Flow 4: adapter throws exception → SUBMISSION_FAILED', () => {
    it('catches adapter exception and sets SUBMISSION_FAILED on attempt 1', async () => {
      const throwingAdapter = {
        adapterKey: 'mock',
        adapterName: 'Throwing Mock',
        submit: jest.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as MockAdapter;

      const statusUpdates: string[] = [];
      const prismaMock = makePrismaMock(makeInvoice(), (data) => {
        if (data.status) statusUpdates.push(data.status);
      });

      const module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          SubmissionService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: ActivityService, useValue: { track: jest.fn() } },
          { provide: MockAdapter, useValue: throwingAdapter },
          {
            provide: InterswitchAdapter,
            useValue: { adapterKey: 'interswitch', submit: jest.fn() },
          },
        ],
      }).compile();

      const service = module.get(SubmissionService);
      await service.processSubmission(makeJobData({ attempt: 1 }));

      expect(statusUpdates).toContain('SUBMISSION_FAILED');
      expect(statusUpdates).not.toContain('DEAD_LETTERED');
    });

    it('sets DEAD_LETTERED when adapter throws on the final attempt', async () => {
      const throwingAdapter = {
        adapterKey: 'mock',
        adapterName: 'Throwing Mock',
        submit: jest.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as MockAdapter;

      const statusUpdates: string[] = [];
      const prismaMock = makePrismaMock(makeInvoice(), (data) => {
        if (data.status) statusUpdates.push(data.status);
      });

      const module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          SubmissionService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: ActivityService, useValue: { track: jest.fn() } },
          { provide: MockAdapter, useValue: throwingAdapter },
          {
            provide: InterswitchAdapter,
            useValue: { adapterKey: 'interswitch', submit: jest.fn() },
          },
        ],
      }).compile();

      const service = module.get(SubmissionService);
      await service.processSubmission(makeJobData({ attempt: 3 }));

      expect(statusUpdates).toContain('DEAD_LETTERED');
    });
  });
});

// ── Source-reference deduplication ────────────────────────────────────────────

describe('Source-reference deduplication', () => {
  function buildInvoiceService(existingInvoice: any): any {
    const repo = {
      findBySourceReference: jest.fn().mockResolvedValue(existingInvoice),
      create: jest.fn(),
      addStateHistory: jest.fn().mockResolvedValue({}),
    };
    return new InvoiceService(
      repo as any,
      { generateUniqueIrn: jest.fn() } as any,
      {} as any,
      { track: jest.fn() } as any,
      { asAdmin: jest.fn() } as any,
      { queueInvoice: jest.fn() } as any,
      { emit: jest.fn() } as any,
      {} as any,
      { sendInvoiceToBuyer: jest.fn() } as any,
    );
  }

  it('returns isDuplicate=true for ACCEPTED invoice with same sourceReference', async () => {
    const acceptedInvoice = {
      ...makeInvoice(),
      status: 'ACCEPTED',
      sourceReference: 'ERP-001',
      firsConfirmedIrn: 'FIRS-001',
      createdAt: new Date(),
      updatedAt: new Date(),
      issueDate: new Date(),
      stateHistory: [],
    };

    const svc = buildInvoiceService(acceptedInvoice);
    const result = await svc.createInvoice(
      'tenant-uuid-001',
      'SANDBOX',
      'apikey:test',
      {
        sourceReference: 'ERP-001',
        seller: { tin: '12345', partyName: 'Seller' },
        buyer: { partyName: 'Buyer' },
        issueDate: new Date().toISOString(),
        lineItems: [],
        taxTotal: [],
        legalMonetaryTotal: {},
      },
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.message).toContain('accepted');
    expect(svc['invoiceRepository'].findBySourceReference).toHaveBeenCalledWith(
      'tenant-uuid-001',
      'ERP-001',
    );
  });

  it('returns isDuplicate=true and "already processing" for SUBMITTING status', async () => {
    const submittingInvoice = {
      ...makeInvoice(),
      status: 'SUBMITTING',
      sourceReference: 'ERP-002',
      createdAt: new Date(),
      updatedAt: new Date(),
      issueDate: new Date(),
      stateHistory: [],
    };

    const svc = buildInvoiceService(submittingInvoice);
    const result = await svc.createInvoice(
      'tenant-uuid-001',
      'SANDBOX',
      'apikey:test',
      {
        sourceReference: 'ERP-002',
        seller: { tin: '12345', partyName: 'Seller' },
        buyer: { partyName: 'Buyer' },
        issueDate: new Date().toISOString(),
        lineItems: [],
        taxTotal: [],
        legalMonetaryTotal: {},
      },
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.message).toContain('processing');
  });
});

// ── RecoveryService — startup reconciliation ──────────────────────────────────

describe('RecoveryService — startup reconciliation', () => {
  it('resets stuck SUBMITTING invoice to QUEUED and re-queues it', async () => {
    const fiveMinsAgo = new Date(Date.now() - 6 * 60 * 1000);
    const stuckInvoice = {
      id: 'invoice-stuck-001',
      tenantId: 'tenant-uuid-001',
      platformIrn: 'STUCK-IRN-001',
      status: 'SUBMITTING',
      updatedAt: fiveMinsAgo,
      tenant: { appAdapterKey: 'mock', interswitchClientId: null },
    };

    const invoiceUpdateMock = jest.fn().mockResolvedValue({});
    const stateHistoryCreateMock = jest.fn().mockResolvedValue({});
    const prismaMock = {
      asAdmin: jest.fn((fn: any) =>
        fn({
          invoice: {
            findMany: jest.fn().mockResolvedValue([stuckInvoice]),
            update: invoiceUpdateMock,
          },
          invoiceStateHistory: { create: stateHistoryCreateMock },
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        RecoveryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ActivityService, useValue: { track: jest.fn() } },
      ],
    }).compile();

    const recoveryService = module.get(RecoveryService);
    const result = await recoveryService.reconcileStuckInvoices();

    expect(result.checked).toBe(1);
    expect(result.recovered).toBe(1);
    expect(result.failed).toBe(0);
    expect(invoiceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'QUEUED' } }),
    );
    expect(stateHistoryCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toStatus: 'QUEUED',
          actor: 'system:recovery',
        }),
      }),
    );
  });

  it('returns checked=0 when no stuck invoices found', async () => {
    const prismaMock = {
      asAdmin: jest.fn((fn: any) =>
        fn({ invoice: { findMany: jest.fn().mockResolvedValue([]) } }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        RecoveryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ActivityService, useValue: { track: jest.fn() } },
      ],
    }).compile();

    const recoveryService = module.get(RecoveryService);
    const result = await recoveryService.reconcileStuckInvoices();

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 });
  });
});
