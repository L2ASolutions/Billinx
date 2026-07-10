/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException, ForbiddenException, MaxFileSizeValidator } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IncomingInvoiceService } from './incoming-invoice.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../activity/services/activity.service';
import { EmailService } from '../../shared/email/email.service';

jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));
import { fromBuffer } from 'file-type';

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

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'document.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake'),
    size: 1024,
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

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

  // ── uploadAttachment — magic-byte MIME verification ────────────────────────

  describe('uploadAttachment', () => {
    const mockUpdate = {
      attachmentName: 'document.pdf',
      attachmentMime: 'application/pdf',
      attachmentSize: 1024,
      updatedAt: new Date(),
    };

    beforeEach(() => {
      prisma.incomingInvoice.findFirst.mockResolvedValue(makeInvoiceRecord());
      prisma.incomingInvoice.update = jest.fn().mockResolvedValue(mockUpdate);
    });

    it('accepts a valid PDF (magic bytes match declared mimetype)', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      const result = await service.uploadAttachment(INVOICE_ID, TENANT_ID, makeFile());
      expect(result.attachmentMime).toBe('application/pdf');
      expect(prisma.incomingInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachmentMime: 'application/pdf' }) }),
      );
    });

    it('accepts a valid JPEG', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      const file = makeFile({ mimetype: 'image/jpeg', originalname: 'photo.jpg' });
      prisma.incomingInvoice.update = jest.fn().mockResolvedValue({ ...mockUpdate, attachmentMime: 'image/jpeg', attachmentName: 'photo.jpg' });
      const result = await service.uploadAttachment(INVOICE_ID, TENANT_ID, file);
      expect(result.attachmentMime).toBe('image/jpeg');
    });

    it('accepts a valid PNG', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/png', ext: 'png' });
      const file = makeFile({ mimetype: 'image/png', originalname: 'image.png' });
      prisma.incomingInvoice.update = jest.fn().mockResolvedValue({ ...mockUpdate, attachmentMime: 'image/png', attachmentName: 'image.png' });
      const result = await service.uploadAttachment(INVOICE_ID, TENANT_ID, file);
      expect(result.attachmentMime).toBe('image/png');
    });

    it('rejects an .exe renamed to .pdf (magic bytes → EXE, claimed → PDF)', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/x-msdownload', ext: 'exe' });
      const file = makeFile({ mimetype: 'application/pdf', originalname: 'document.pdf' });
      await expect(service.uploadAttachment(INVOICE_ID, TENANT_ID, file)).rejects.toThrow(
        new BadRequestException('Unsupported file type. Only PDF, JPEG, and PNG files are accepted.'),
      );
      expect(prisma.incomingInvoice.update).not.toHaveBeenCalled();
    });

    it('rejects an unsupported type (.docx) even when claimed MIME matches', async () => {
      const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: docxMime, ext: 'docx' });
      const file = makeFile({ mimetype: docxMime, originalname: 'report.docx' });
      await expect(service.uploadAttachment(INVOICE_ID, TENANT_ID, file)).rejects.toThrow(
        new BadRequestException('Unsupported file type. Only PDF, JPEG, and PNG files are accepted.'),
      );
      expect(prisma.incomingInvoice.update).not.toHaveBeenCalled();
    });

    it('rejects when magic bytes are unrecognized (fromBuffer returns undefined)', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue(undefined);
      await expect(service.uploadAttachment(INVOICE_ID, TENANT_ID, makeFile())).rejects.toThrow(
        new BadRequestException('Unsupported file type. Only PDF, JPEG, and PNG files are accepted.'),
      );
    });

    it('rejects when detected MIME does not match declared MIME (mismatch attack)', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      const file = makeFile({ mimetype: 'application/pdf', originalname: 'sneaky.pdf' });
      await expect(service.uploadAttachment(INVOICE_ID, TENANT_ID, file)).rejects.toThrow(
        new BadRequestException('File content does not match the declared content type.'),
      );
    });

    it('stores detected MIME type, not the client-supplied mimetype', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      const file = makeFile({ mimetype: 'image/jpg', originalname: 'photo.jpg' });
      prisma.incomingInvoice.update = jest.fn().mockResolvedValue({ ...mockUpdate, attachmentMime: 'image/jpeg' });
      await service.uploadAttachment(INVOICE_ID, TENANT_ID, file);
      expect(prisma.incomingInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachmentMime: 'image/jpeg' }) }),
      );
    });
  });

  // ── uploadAttachment — stream-level size enforcement ───────────────────────
  // The 10 MB limit is enforced at two layers:
  //   1. Multer stream level: FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })
  //      in incoming-invoice.controller.ts — the request body is never fully buffered.
  //   2. ParseFilePipe + MaxFileSizeValidator in the @UploadedFile() decorator —
  //      runs at the controller layer before uploadAttachment is called.
  // These tests verify the ParseFilePipe validator directly.

  describe('uploadAttachment — size enforcement (ParseFilePipe layer)', () => {
    it('rejects files larger than 10 MB before the service handler is reached', () => {
      const validator = new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 });
      const oversized = makeFile({ size: 10 * 1024 * 1024 + 1 });
      expect(validator.isValid(oversized)).toBe(false);
    });

    it('accepts files strictly under 10 MB', () => {
      // NestJS v11 MaxFileSizeValidator uses >= comparison: files must be
      // strictly less than maxSize bytes to pass.
      const validator = new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 });
      const underLimit = makeFile({ size: 10 * 1024 * 1024 - 1 });
      expect(validator.isValid(underLimit)).toBe(true);
    });
  });
});
