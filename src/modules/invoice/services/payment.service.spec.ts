/// <reference types="jest" />

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { addToUpdateStatusQueue } from '../../submission/queues/update-status.queue';

jest.mock('../../submission/queues/update-status.queue', () => ({
  addToUpdateStatusQueue: jest.fn().mockResolvedValue(undefined),
}));

const mockedAddToUpdateStatusQueue =
  addToUpdateStatusQueue as jest.MockedFunction<typeof addToUpdateStatusQueue>;

describe('PaymentService', () => {
  let prisma: { asAdmin: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let activityService: { track: jest.Mock };
  let service: PaymentService;

  function makeInvoice(overrides: Record<string, any> = {}) {
    return {
      id: 'invoice-1',
      tenantId: 'tenant-1',
      status: 'ACCEPTED',
      totalAmount: 1000,
      amountPaid: 0,
      currency: 'NGN',
      platformIrn: 'PLATFORM-IRN-1',
      firsConfirmedIrn: 'FIRS-IRN-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAddToUpdateStatusQueue.mockResolvedValue(undefined);

    prisma = { asAdmin: jest.fn((fn: any) => fn({})) };
    eventEmitter = { emit: jest.fn() };
    activityService = { track: jest.fn() };
    service = new PaymentService(
      prisma as any,
      eventEmitter as any,
      activityService as any,
    );
  });

  describe('recordPayment', () => {
    const validBody = {
      amount: 500,
      reference: 'REF-1',
      provider: 'PAYSTACK',
      paidAt: '2026-07-01T00:00:00.000Z',
    };

    it('throws BadRequestException for an invalid provider', async () => {
      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', {
          ...validBody,
          provider: 'BOGUS',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a non-positive amount', async () => {
      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', {
          ...validBody,
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a blank reference', async () => {
      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', {
          ...validBody,
          reference: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an invalid paidAt', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          invoice: { findUnique: jest.fn().mockResolvedValue(makeInvoice()) },
        }),
      );

      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', {
          ...validBody,
          paidAt: 'not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the invoice does not exist', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ invoice: { findUnique: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the invoice belongs to another tenant', async () => {
      const invoice = makeInvoice({ tenantId: 'other-tenant' });
      prisma.asAdmin.mockImplementationOnce((fn: any) =>
        fn({
          invoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
        }),
      );

      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the invoice is not ACCEPTED', async () => {
      const invoice = makeInvoice({ status: 'DRAFT' });
      prisma.asAdmin.mockImplementationOnce((fn: any) =>
        fn({
          invoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
        }),
      );

      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody),
      ).rejects.toThrow(BadRequestException);
    });

    function mockAcceptedInvoice(invoice: any, payment: any) {
      let call = 0;
      prisma.asAdmin.mockImplementation((fn: any) => {
        call += 1;
        if (call === 1) {
          return fn({
            invoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
          });
        }
        return fn({
          paymentRecord: { create: jest.fn().mockResolvedValue(payment) },
          invoice: { update: jest.fn().mockResolvedValue({}) },
        });
      });
    }

    it('marks the invoice PARTIAL when the payment does not cover the full amount', async () => {
      const invoice = makeInvoice();
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      const result = await service.recordPayment(
        'invoice-1',
        'tenant-1',
        'user-1',
        validBody,
      );

      expect(result.paymentStatus).toBe('PARTIAL');
      expect(result.amountOutstanding).toBe(500);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.partial',
        expect.objectContaining({ eventType: 'payment.partial' }),
      );
    });

    it('marks the invoice PAID when the payment covers the full amount', async () => {
      const invoice = makeInvoice({ totalAmount: 500 });
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      const result = await service.recordPayment(
        'invoice-1',
        'tenant-1',
        'user-1',
        validBody,
      );

      expect(result.paymentStatus).toBe('PAID');
      expect(result.amountOutstanding).toBe(0);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.confirmed',
        expect.objectContaining({ eventType: 'payment.confirmed' }),
      );
    });

    it('enqueues an NRS UpdateStatus job when the invoice has a firsConfirmedIrn', async () => {
      const invoice = makeInvoice({ totalAmount: 500 });
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      await service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody);

      expect(mockedAddToUpdateStatusQueue).toHaveBeenCalledWith({
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        irn: 'FIRS-IRN-1',
        status: 'PAID',
      });
    });

    it('includes amount in the enqueued job for a PARTIAL payment', async () => {
      const invoice = makeInvoice();
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      await service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody);

      expect(mockedAddToUpdateStatusQueue).toHaveBeenCalledWith({
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        irn: 'FIRS-IRN-1',
        status: 'PARTIAL',
        amount: 500,
      });
    });

    it('does not enqueue an UpdateStatus job when firsConfirmedIrn is absent', async () => {
      const invoice = makeInvoice({ firsConfirmedIrn: null, totalAmount: 500 });
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      await service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody);

      expect(mockedAddToUpdateStatusQueue).not.toHaveBeenCalled();
    });

    it('does not throw when enqueuing the UpdateStatus job fails', async () => {
      const invoice = makeInvoice({ totalAmount: 500 });
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);
      mockedAddToUpdateStatusQueue.mockRejectedValue(new Error('redis down'));

      await expect(
        service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody),
      ).resolves.toBeDefined();
    });

    it('tracks a PAYMENT_RECORDED activity event', async () => {
      const invoice = makeInvoice({ totalAmount: 500 });
      const payment = {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: 'tenant-1',
        amount: 500,
        currency: 'NGN',
        paymentReference: 'REF-1',
        provider: 'PAYSTACK',
        paidAt: new Date(validBody.paidAt),
        createdAt: new Date(),
      };
      mockAcceptedInvoice(invoice, payment);

      await service.recordPayment('invoice-1', 'tenant-1', 'user-1', validBody);

      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PAYMENT_RECORDED',
          actor: 'user-1',
          entityId: 'invoice-1',
        }),
      );
    });
  });

  describe('listPayments', () => {
    it('throws NotFoundException when the invoice does not exist', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ invoice: { findUnique: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(
        service.listPayments('invoice-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns payment records with computed amountOutstanding', async () => {
      let call = 0;
      prisma.asAdmin.mockImplementation((fn: any) => {
        call += 1;
        if (call === 1) {
          return fn({
            invoice: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'invoice-1',
                tenantId: 'tenant-1',
                totalAmount: 1000,
                amountPaid: 400,
                paymentStatus: 'PARTIAL',
              }),
            },
          });
        }
        return fn({
          paymentRecord: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'payment-1',
                invoiceId: 'invoice-1',
                tenantId: 'tenant-1',
                amount: 400,
                currency: 'NGN',
                paymentReference: 'REF-1',
                provider: 'PAYSTACK',
                paidAt: new Date('2026-07-01'),
                createdAt: new Date('2026-07-01'),
              },
            ]),
          },
        });
      });

      const result = await service.listPayments('invoice-1', 'tenant-1');

      expect(result.total).toBe(1);
      expect(result.amountPaid).toBe(400);
      expect(result.amountOutstanding).toBe(600);
      expect(result.paymentStatus).toBe('PARTIAL');
    });
  });

  describe('detectOverdueInvoices', () => {
    it('does nothing when there are no newly overdue invoices', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ invoice: { findMany: jest.fn().mockResolvedValue([]) } }),
      );

      await service.detectOverdueInvoices();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('marks invoices overdue and emits invoice.overdue events', async () => {
      const overdueInvoice = {
        id: 'invoice-1',
        tenantId: 'tenant-1',
        platformIrn: 'PLATFORM-IRN-1',
        buyerName: 'Acme',
        totalAmount: 1000,
        amountPaid: 200,
        paymentDueDate: new Date('2026-06-01'),
        currency: 'NGN',
      };
      let call = 0;
      prisma.asAdmin.mockImplementation((fn: any) => {
        call += 1;
        if (call === 1) {
          return fn({
            invoice: {
              findMany: jest.fn().mockResolvedValue([overdueInvoice]),
            },
          });
        }
        return fn({ invoice: { updateMany: jest.fn().mockResolvedValue({}) } });
      });

      await service.detectOverdueInvoices();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'invoice.overdue',
        expect.objectContaining({
          invoiceId: 'invoice-1',
          data: expect.objectContaining({ amountOutstanding: 800 }),
        }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INVOICE_OVERDUE' }),
      );
    });
  });
});
