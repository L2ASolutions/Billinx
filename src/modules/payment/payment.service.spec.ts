/// <reference types="jest" />

// Module-level constants (PAYSTACK_SECRET/FLW_SECRET/BILLINX_URL) are captured
// from process.env at import time, so set them before the first import.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_realsecret';
process.env.FLW_SECRET_KEY = 'FLWSECK_realsecret';
process.env.BILLINX_URL = 'https://app.billinx.ng';

import * as https from 'https';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentProviderService } from './payment.service';

jest.mock('https');

// ── https mock helper ──────────────────────────────────────────────────────────

function mockHttpsJsonResponse(jsonBody: unknown) {
  (https.request as unknown as jest.Mock).mockImplementation(
    (_options: unknown, callback: (res: any) => void) => {
      const handlers: Record<string, (arg?: any) => void> = {};
      const res = {
        on(event: string, handler: (arg?: any) => void) {
          handlers[event] = handler;
          return res;
        },
      };
      callback(res);
      process.nextTick(() => {
        handlers.data?.(Buffer.from(JSON.stringify(jsonBody)));
        handlers.end?.();
      });
      return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    },
  );
}

function mockHttpsError(err: Error) {
  (https.request as unknown as jest.Mock).mockImplementation(() => ({
    on: jest.fn((event: string, handler: (e: Error) => void) => {
      if (event === 'error') process.nextTick(() => handler(err));
    }),
    write: jest.fn(),
    end: jest.fn(),
  }));
}

function mockHttpsTimeout() {
  (https.request as unknown as jest.Mock).mockImplementation(() => {
    const handlers: Record<string, (arg?: any) => void> = {};
    const req: any = {
      on: jest.fn((event: string, handler: (arg?: any) => void) => {
        handlers[event] = handler;
        return req;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn((err?: Error) => {
        process.nextTick(() => handlers.error?.(err));
      }),
    };
    process.nextTick(() => handlers.timeout?.());
    return req;
  });
}

function mockHttpsOversizedResponse(totalBytes: number) {
  const destroy = jest.fn();
  (https.request as unknown as jest.Mock).mockImplementation(
    (_options: unknown, callback: (res: any) => void) => {
      const handlers: Record<string, (arg?: any) => void> = {};
      const res = {
        on(event: string, handler: (arg?: any) => void) {
          handlers[event] = handler;
          return res;
        },
        destroy,
      };
      callback(res);
      process.nextTick(() => {
        handlers.data?.(Buffer.alloc(totalBytes, 'a'));
        handlers.end?.();
      });
      return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    },
  );
  return destroy;
}

// PAYSTACK_SECRET/FLW_SECRET are captured from process.env at module-load time,
// so "not configured" scenarios need a fresh module instance with different env.
function loadServiceWithEnv(env: Record<string, string>): any {
  let Fresh: any;
  jest.isolateModules(() => {
    Object.assign(process.env, env);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs synchronous require to get a fresh module instance
    Fresh = require('./payment.service').PaymentProviderService;
  });
  return Fresh;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const INVOICE_ID = 'a1b2c3d4-e5f6-4789-a012-b34567890abc'; // valid UUID shape
const TENANT_ID = 'tenant-001';

function makeInvoiceRecord(overrides: Record<string, any> = {}): any {
  return {
    id: INVOICE_ID,
    tenantId: TENANT_ID,
    platformIrn: 'IRN-0001',
    firsConfirmedIrn: 'FIRS-IRN-0001',
    status: 'ACCEPTED',
    currency: 'NGN',
    totalAmount: 10000,
    amountPaid: 0,
    buyerName: 'Acme Buyer',
    sellerName: 'Acme Seller',
    paymentLink: null,
    metadata: { buyerParty: { email: 'buyer@example.com' } },
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(makeInvoiceRecord()),
    },
    paymentRecord: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    ...overrides,
  };
  return { prisma, tx };
}

describe('PaymentProviderService', () => {
  let service: PaymentProviderService;
  let prisma: any;
  let tx: any;
  let invoicePaymentService: { recordPayment: jest.Mock };
  let emailService: { sendBuyerPaymentReceipt: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    ({ prisma, tx } = makePrisma());
    invoicePaymentService = {
      recordPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    };
    emailService = { sendBuyerPaymentReceipt: jest.fn() };
    service = new PaymentProviderService(
      prisma,
      invoicePaymentService as any,
      emailService as any,
    );
  });

  // ── paystackInitialize ──────────────────────────────────────────────────────

  describe('paystackInitialize', () => {
    it('throws NotFoundException when invoice does not exist', async () => {
      tx.invoice.findUnique.mockResolvedValue(null);
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when invoice is not ACCEPTED', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        makeInvoiceRecord({ status: 'DRAFT' }),
      );
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invoice is already fully paid', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        makeInvoiceRecord({ totalAmount: 5000, amountPaid: 5000 }),
      );
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('Invoice is already fully paid');
    });

    it('throws BadRequestException when Paystack is not configured', async () => {
      const Fresh = loadServiceWithEnv({ PAYSTACK_SECRET_KEY: '' });
      const freshService = new Fresh(
        prisma,
        invoicePaymentService,
        emailService,
      );
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_realsecret';
      await expect(
        freshService.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('Paystack is not configured');
    });

    it('initializes a payment and returns the authorization URL', async () => {
      mockHttpsJsonResponse({
        status: true,
        data: {
          authorization_url: 'https://paystack.co/pay/xyz',
          reference: 'BLX-ref-1',
        },
      });

      const result = await service.paystackInitialize(
        INVOICE_ID,
        'buyer@example.com',
      );

      expect(result).toEqual({
        authorizationUrl: 'https://paystack.co/pay/xyz',
        reference: 'BLX-ref-1',
      });

      const reqOptions = (https.request as unknown as jest.Mock).mock
        .calls[0][0];
      expect(reqOptions.hostname).toBe('api.paystack.co');
      expect(reqOptions.headers.Authorization).toBe(
        'Bearer sk_test_realsecret',
      );
    });

    it('sends the outstanding amount in kobo (amount * 100)', async () => {
      mockHttpsJsonResponse({
        status: true,
        data: {
          authorization_url: 'https://paystack.co/pay/xyz',
          reference: 'BLX-ref-1',
        },
      });
      tx.invoice.findUnique.mockResolvedValue(
        makeInvoiceRecord({ totalAmount: 1500.5, amountPaid: 500.5 }),
      );

      await service.paystackInitialize(INVOICE_ID, 'buyer@example.com');

      const writeCall = (https.request as unknown as jest.Mock).mock.results[0]
        .value.write.mock.calls[0][0];
      const sentBody = JSON.parse(writeCall);
      expect(sentBody.amount).toBe(100000); // (1500.50 - 500.50) * 100
      expect(sentBody.metadata.invoiceId).toBe(INVOICE_ID);
    });

    it('throws BadRequestException with the provider message when initialization fails', async () => {
      mockHttpsJsonResponse({
        status: false,
        message: 'Invalid email address',
      });
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('Invalid email address');
    });

    it('propagates a network error when the Paystack request itself fails', async () => {
      mockHttpsError(new Error('ECONNREFUSED'));
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('rejects when the request times out instead of hanging indefinitely', async () => {
      mockHttpsTimeout();
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow(/timed out after 20000ms/);
    });

    it('rejects and destroys the response when it exceeds the maximum allowed size', async () => {
      const destroy = mockHttpsOversizedResponse(5 * 1024 * 1024 + 1);
      await expect(
        service.paystackInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow(/exceeded maximum allowed size/);
      expect(destroy).toHaveBeenCalled();
    });
  });

  // ── paystackVerify ──────────────────────────────────────────────────────────

  describe('paystackVerify', () => {
    it('returns "not configured" without calling Paystack when secret is a placeholder', async () => {
      const Fresh = loadServiceWithEnv({
        PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
      });
      const freshService = new Fresh(
        prisma,
        invoicePaymentService,
        emailService,
      );
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_realsecret';

      const result = await freshService.paystackVerify('BLX-ref-1');
      expect(result).toEqual({
        status: 'unknown',
        message: 'Paystack not configured',
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('maps provider verify response to a normalized shape', async () => {
      mockHttpsJsonResponse({
        data: {
          status: 'success',
          amount: 250000,
          reference: 'BLX-ref-1',
          paid_at: '2026-07-04T10:00:00.000Z',
          customer: { email: 'buyer@example.com' },
          metadata: { invoiceId: INVOICE_ID },
        },
      });

      const result = await service.paystackVerify('BLX-ref-1');

      expect(result).toEqual({
        status: 'success',
        amount: 2500, // amount / 100
        reference: 'BLX-ref-1',
        paidAt: '2026-07-04T10:00:00.000Z',
        customerEmail: 'buyer@example.com',
        metadata: { invoiceId: INVOICE_ID },
      });
    });
  });

  // ── paystackWebhookEvent ─────────────────────────────────────────────────────

  describe('paystackWebhookEvent', () => {
    it('ignores events other than charge.success', async () => {
      const result = await service.paystackWebhookEvent({
        event: 'charge.failed',
        data: {},
      });
      expect(result).toEqual({ received: true });
      expect(prisma.asAdmin).not.toHaveBeenCalled();
    });

    it('records payment using invoiceId from metadata when present', async () => {
      await service.paystackWebhookEvent({
        event: 'charge.success',
        data: {
          amount: 250000,
          reference: 'BLX-whatever-1234567890',
          metadata: { invoiceId: INVOICE_ID },
        },
      });

      expect(invoicePaymentService.recordPayment).toHaveBeenCalledWith(
        INVOICE_ID,
        TENANT_ID,
        'webhook',
        expect.objectContaining({ amount: 2500, provider: 'PAYSTACK' }),
      );
    });

    it('extracts invoiceId from the reference when metadata is absent', async () => {
      const reference = `BLX-${INVOICE_ID}-1735689600000`;
      await service.paystackWebhookEvent({
        event: 'charge.success',
        data: { amount: 100000, reference },
      });

      expect(invoicePaymentService.recordPayment).toHaveBeenCalledWith(
        INVOICE_ID,
        TENANT_ID,
        'webhook',
        expect.objectContaining({ amount: 1000, reference }),
      );
    });

    it('does nothing (no throw) when invoiceId cannot be recovered from a malformed reference', async () => {
      const result = await service.paystackWebhookEvent({
        event: 'charge.success',
        data: { amount: 100000, reference: 'BLX-not-a-uuid-1234567890' },
      });
      expect(result).toEqual({ received: true });
      expect(prisma.asAdmin).not.toHaveBeenCalled();
      expect(invoicePaymentService.recordPayment).not.toHaveBeenCalled();
    });
  });

  // ── flutterwaveInitialize ────────────────────────────────────────────────────

  describe('flutterwaveInitialize', () => {
    it('throws BadRequestException when Flutterwave is not configured', async () => {
      const Fresh = loadServiceWithEnv({ FLW_SECRET_KEY: '' });
      const freshService = new Fresh(
        prisma,
        invoicePaymentService,
        emailService,
      );
      process.env.FLW_SECRET_KEY = 'FLWSECK_realsecret';
      await expect(
        freshService.flutterwaveInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('Flutterwave is not configured');
    });

    it('initializes a payment and returns the payment link', async () => {
      mockHttpsJsonResponse({
        status: 'success',
        data: { link: 'https://flutterwave.com/pay/xyz' },
      });

      const result = await service.flutterwaveInitialize(
        INVOICE_ID,
        'buyer@example.com',
      );

      expect(result).toEqual({
        paymentLink: 'https://flutterwave.com/pay/xyz',
      });
      const reqOptions = (https.request as unknown as jest.Mock).mock
        .calls[0][0];
      expect(reqOptions.hostname).toBe('api.flutterwave.com');
    });

    it('sends the outstanding amount in naira (no *100 conversion)', async () => {
      mockHttpsJsonResponse({
        status: 'success',
        data: { link: 'https://flutterwave.com/pay/xyz' },
      });
      tx.invoice.findUnique.mockResolvedValue(
        makeInvoiceRecord({ totalAmount: 1500.5, amountPaid: 500.5 }),
      );

      await service.flutterwaveInitialize(INVOICE_ID, 'buyer@example.com');

      const writeCall = (https.request as unknown as jest.Mock).mock.results[0]
        .value.write.mock.calls[0][0];
      const sentBody = JSON.parse(writeCall);
      expect(sentBody.amount).toBe(1000);
    });

    it('throws BadRequestException when provider status is not success', async () => {
      mockHttpsJsonResponse({ status: 'error', message: 'Card declined' });
      await expect(
        service.flutterwaveInitialize(INVOICE_ID, 'buyer@example.com'),
      ).rejects.toThrow('Card declined');
    });
  });

  // ── flutterwaveWebhookEvent ──────────────────────────────────────────────────

  describe('flutterwaveWebhookEvent', () => {
    it('ignores events other than charge.completed', async () => {
      const result = await service.flutterwaveWebhookEvent({
        event: 'charge.failed',
        data: {},
      });
      expect(result).toEqual({ received: true });
      expect(prisma.asAdmin).not.toHaveBeenCalled();
    });

    it('ignores charge.completed events whose status is not successful', async () => {
      const result = await service.flutterwaveWebhookEvent({
        event: 'charge.completed',
        data: { status: 'failed' },
      });
      expect(result).toEqual({ received: true });
      expect(prisma.asAdmin).not.toHaveBeenCalled();
    });

    it('extracts invoiceId from the FLW- prefixed tx_ref when meta is absent', async () => {
      const txRef = `BLX-FLW-${INVOICE_ID}-1735689600000`;
      await service.flutterwaveWebhookEvent({
        event: 'charge.completed',
        data: { status: 'successful', amount: 1000, tx_ref: txRef },
      });

      expect(invoicePaymentService.recordPayment).toHaveBeenCalledWith(
        INVOICE_ID,
        TENANT_ID,
        'webhook',
        expect.objectContaining({
          amount: 1000,
          provider: 'FLUTTERWAVE',
          reference: txRef,
        }),
      );
    });

    it('prefers invoiceId from meta over parsing tx_ref', async () => {
      await service.flutterwaveWebhookEvent({
        event: 'charge.completed',
        data: {
          status: 'successful',
          amount: 1000,
          tx_ref: 'garbage',
          meta: { invoiceId: INVOICE_ID },
        },
      });

      expect(invoicePaymentService.recordPayment).toHaveBeenCalledWith(
        INVOICE_ID,
        TENANT_ID,
        'webhook',
        expect.anything(),
      );
    });
  });

  // ── recordWebhookPayment (exercised via the webhook handlers) ────────────────

  describe('webhook payment recording side-effects', () => {
    const fireWebhook = () =>
      service.paystackWebhookEvent({
        event: 'charge.success',
        data: {
          amount: 250000,
          reference: 'BLX-x',
          metadata: { invoiceId: INVOICE_ID },
        },
      });

    it('skips recording when amount is zero or negative', async () => {
      await service.paystackWebhookEvent({
        event: 'charge.success',
        data: {
          amount: 0,
          reference: 'BLX-x',
          metadata: { invoiceId: INVOICE_ID },
        },
      });
      expect(invoicePaymentService.recordPayment).not.toHaveBeenCalled();
    });

    it('skips recording (no throw) when a PaymentRecord with the same reference already exists', async () => {
      tx.paymentRecord.findFirst.mockResolvedValue({ id: 'existing-payment' });
      const result = await fireWebhook();
      expect(result).toEqual({ received: true });
      expect(invoicePaymentService.recordPayment).not.toHaveBeenCalled();
    });

    it('skips gracefully (no throw) when the invoice is not found', async () => {
      tx.paymentRecord.findFirst.mockResolvedValue(null);
      tx.invoice.findUnique.mockResolvedValue(null);
      const result = await fireWebhook();
      expect(result).toEqual({ received: true });
      expect(invoicePaymentService.recordPayment).not.toHaveBeenCalled();
    });

    it('sends a buyer payment receipt email when the invoice has a buyer email in metadata', async () => {
      await fireWebhook();
      expect(emailService.sendBuyerPaymentReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'buyer@example.com',
          reference: 'BLX-x',
          provider: 'PAYSTACK',
        }),
      );
    });

    it('does not send an email when the invoice metadata has no buyer email', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        makeInvoiceRecord({ metadata: {} }),
      );
      await fireWebhook();
      expect(emailService.sendBuyerPaymentReceipt).not.toHaveBeenCalled();
    });

    it('swallows errors from recordPayment so the webhook still resolves', async () => {
      invoicePaymentService.recordPayment.mockRejectedValue(
        new Error('db down'),
      );
      await expect(fireWebhook()).resolves.toEqual({ received: true });
    });
  });
});
