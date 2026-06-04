/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IncomingInvoiceService } from './incoming-invoice.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../activity/services/activity.service';
import { EmailService } from '../../shared/email/email.service';

// ── Mock request context ──────────────────────────────────────────────────────

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const INVOICE_ID = 'invoice-001';

function makeInvoiceRecord(overrides: Record<string, any> = {}): any {
  return {
    id: INVOICE_ID,
    tenantId: TENANT_ID,
    supplierName: 'Acme Ltd',
    supplierTin: '12345678-0001',
    invoiceNumber: 'INV-001',
    invoiceAmount: 100000,
    vatAmount: 7500,
    currency: 'NGN',
    invoiceDate: new Date('2026-05-01'),
    dueDate: null,
    status: 'RECEIVED',
    description: null,
    sourceReference: null,
    rejectionReason: null,
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDto(overrides: Record<string, any> = {}): any {
  return {
    supplierName: 'Acme Ltd',
    supplierTin: '12345678-0001',
    invoiceNumber: 'INV-001',
    invoiceAmount: 100000,
    vatAmount: 7500,
    invoiceDate: '2026-05-01T00:00:00.000Z',
    currency: 'NGN',
    items: [],
    ...overrides,
  };
}

// ── Prisma mock factory ───────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}): any {
  const record = makeInvoiceRecord();
  return {
    incomingInvoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(record),
      findMany: jest.fn().mockResolvedValue([record]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(record),
      update: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...record, ...data, items: [] }),
      ),
    },
    asAdmin: jest.fn().mockResolvedValue([{ role: 'OWNER' }]),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IncomingInvoiceService', () => {
  let service: IncomingInvoiceService;
  let prisma: any;
  let activityTrack: jest.Mock;

  async function build(prismaOverrides: Record<string, any> = {}) {
    prisma = makePrisma(prismaOverrides);
    activityTrack = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomingInvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityService, useValue: { track: activityTrack } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: EmailService, useValue: { sendPaymentReceipt: jest.fn() } },
      ],
    }).compile();
    service = module.get(IncomingInvoiceService);
  }

  beforeEach(() => build());

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new invoice and tracks activity', async () => {
      prisma.incomingInvoice.findUnique.mockResolvedValue(null);
      const result = await service.create(TENANT_ID, makeDto());
      expect(prisma.incomingInvoice.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('RECEIVED');
      expect(activityTrack).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOMING_INVOICE_RECEIVED' }),
      );
    });

    it('throws 409 when same invoiceNumber + supplierTin already exists', async () => {
      prisma.incomingInvoice.findUnique.mockResolvedValue(makeInvoiceRecord());
      await expect(service.create(TENANT_ID, makeDto())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns paginated list', async () => {
      const result = await service.list(TENANT_ID, { page: 1, limit: 20 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('applies status filter', async () => {
      await service.list(TENANT_ID, { status: 'RECEIVED' });
      expect(prisma.incomingInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'RECEIVED' }) }),
      );
    });
  });

  // ── validate ──────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('transitions RECEIVED → VALIDATED', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'RECEIVED' }));
      const result = await service.validate(INVOICE_ID, TENANT_ID);
      expect(result.status).toBe('VALIDATED');
      expect(activityTrack).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOMING_INVOICE_VALIDATED' }),
      );
    });

    it('throws 400 if invoice is not in RECEIVED status', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'APPROVED' }));
      await expect(service.validate(INVOICE_ID, TENANT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 if invoiceAmount is zero', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(
        makeInvoiceRecord({ invoiceAmount: 0, status: 'RECEIVED' }),
      );
      await expect(service.validate(INVOICE_ID, TENANT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 if invoice not found', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(null);
      await expect(service.validate(INVOICE_ID, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('transitions VALIDATED → APPROVED for OWNER', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'VALIDATED' }));
      prisma.asAdmin = jest.fn().mockResolvedValue([{ role: 'OWNER' }]);
      const result = await service.approve(INVOICE_ID, TENANT_ID);
      expect(result.status).toBe('APPROVED');
      expect(activityTrack).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOMING_INVOICE_APPROVED' }),
      );
    });

    it('throws 403 if actor is not OWNER or ADMIN', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'VALIDATED' }));
      prisma.asAdmin = jest.fn().mockResolvedValue([{ role: 'VIEWER' }]);
      await expect(service.approve(INVOICE_ID, TENANT_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 400 if invoice is not VALIDATED', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'RECEIVED' }));
      await expect(service.approve(INVOICE_ID, TENANT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('transitions to REJECTED with reason', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'RECEIVED' }));
      const result = await service.reject(INVOICE_ID, TENANT_ID, { reason: 'Wrong amount' });
      expect(result.status).toBe('REJECTED');
      expect(activityTrack).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOMING_INVOICE_REJECTED' }),
      );
    });

    it('throws 400 if invoice is already PAID', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'PAID' }));
      await expect(
        service.reject(INVOICE_ID, TENANT_ID, { reason: 'Late' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── markPaid ──────────────────────────────────────────────────────────────

  describe('markPaid', () => {
    it('transitions APPROVED → PAID', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'APPROVED' }));
      const result = await service.markPaid(INVOICE_ID, TENANT_ID, {
        amount: 100000,
        reference: 'TRX-001',
        provider: 'BANK_TRANSFER',
        paidAt: '2026-05-29T10:00:00.000Z',
      });
      expect(result.status).toBe('PAID');
      expect(activityTrack).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOMING_INVOICE_PAID' }),
      );
    });

    it('throws 400 if invoice is not APPROVED', async () => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord({ status: 'VALIDATED' }));
      await expect(
        service.markPaid(INVOICE_ID, TENANT_ID, {
          amount: 100000,
          reference: 'TRX-001',
          provider: 'BANK_TRANSFER',
          paidAt: '2026-05-29T10:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
