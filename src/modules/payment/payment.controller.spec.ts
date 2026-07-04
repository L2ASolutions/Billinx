/// <reference types="jest" />

import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentProviderService } from './payment.service';

function makeRawBodyRequest(event: Record<string, any>): any {
  const raw = Buffer.from(JSON.stringify(event));
  return { rawBody: raw, body: event };
}

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: jest.Mocked<
    Pick<
      PaymentProviderService,
      | 'paystackInitialize'
      | 'paystackVerify'
      | 'paystackWebhookEvent'
      | 'flutterwaveInitialize'
      | 'flutterwaveWebhookEvent'
    >
  >;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    paymentService = {
      paystackInitialize: jest.fn().mockResolvedValue({
        authorizationUrl: 'https://x',
        reference: 'ref-1',
      }),
      paystackVerify: jest.fn().mockResolvedValue({ status: 'success' }),
      paystackWebhookEvent: jest.fn().mockResolvedValue({ received: true }),
      flutterwaveInitialize: jest
        .fn()
        .mockResolvedValue({ paymentLink: 'https://y' }),
      flutterwaveWebhookEvent: jest.fn().mockResolvedValue({ received: true }),
    };
    controller = new PaymentController(
      paymentService as unknown as PaymentProviderService,
    );
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Paystack initialize/verify delegation ────────────────────────────────────

  it('paystackInitialize delegates invoiceId and email to the service', async () => {
    const result = await controller.paystackInitialize({
      invoiceId: 'inv-1',
      email: 'buyer@x.com',
    });
    expect(paymentService.paystackInitialize).toHaveBeenCalledWith(
      'inv-1',
      'buyer@x.com',
    );
    expect(result).toEqual({
      authorizationUrl: 'https://x',
      reference: 'ref-1',
    });
  });

  it('paystackVerify delegates the reference param to the service', async () => {
    const result = await controller.paystackVerify('ref-1');
    expect(paymentService.paystackVerify).toHaveBeenCalledWith('ref-1');
    expect(result).toEqual({ status: 'success' });
  });

  it('flutterwaveInitialize delegates invoiceId and email to the service', async () => {
    await controller.flutterwaveInitialize({
      invoiceId: 'inv-1',
      email: 'buyer@x.com',
    });
    expect(paymentService.flutterwaveInitialize).toHaveBeenCalledWith(
      'inv-1',
      'buyer@x.com',
    );
  });

  // ── Paystack webhook signature verification ──────────────────────────────────

  describe('paystackWebhook', () => {
    it('skips signature verification and forwards the event when the secret is unset', async () => {
      delete process.env.PAYSTACK_SECRET_KEY;
      const event = { event: 'charge.success', data: {} };
      const result = await controller.paystackWebhook(
        'any-signature',
        makeRawBodyRequest(event),
      );
      expect(paymentService.paystackWebhookEvent).toHaveBeenCalledWith(event);
      expect(result).toEqual({ received: true });
    });

    it('skips signature verification when the secret is the test placeholder', async () => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_placeholder';
      const event = { event: 'charge.success', data: {} };
      await controller.paystackWebhook(
        'any-signature',
        makeRawBodyRequest(event),
      );
      expect(paymentService.paystackWebhookEvent).toHaveBeenCalledWith(event);
    });

    it('accepts the request when the HMAC-SHA512 signature matches the raw body', async () => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_live_realsecret';
      const event = { event: 'charge.success', data: { reference: 'BLX-x' } };
      const req = makeRawBodyRequest(event);
      const validSignature = crypto
        .createHmac('sha512', 'sk_live_realsecret')
        .update(req.rawBody)
        .digest('hex');

      const result = await controller.paystackWebhook(validSignature, req);

      expect(paymentService.paystackWebhookEvent).toHaveBeenCalledWith(event);
      expect(result).toEqual({ received: true });
    });

    it('throws UnauthorizedException and does not call the service when the signature does not match', async () => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_live_realsecret';
      const event = { event: 'charge.success', data: {} };
      const req = makeRawBodyRequest(event);

      await expect(
        controller.paystackWebhook('totally-wrong-signature', req),
      ).rejects.toThrow(UnauthorizedException);
      expect(paymentService.paystackWebhookEvent).not.toHaveBeenCalled();
    });

    it('falls back to req.body when rawBody is not present', async () => {
      delete process.env.PAYSTACK_SECRET_KEY;
      const event = { event: 'charge.success', data: {} };
      const req = { rawBody: undefined, body: event } as any;

      await controller.paystackWebhook('any-signature', req);
      expect(paymentService.paystackWebhookEvent).toHaveBeenCalledWith(event);
    });
  });

  // ── Flutterwave webhook signature verification ───────────────────────────────

  describe('flutterwaveWebhook', () => {
    it('skips signature verification and forwards the event when no webhook hash is configured', async () => {
      delete process.env.FLW_WEBHOOK_HASH;
      const event = { event: 'charge.completed', data: {} };
      const result = await controller.flutterwaveWebhook(
        'any-hash',
        makeRawBodyRequest(event),
      );
      expect(paymentService.flutterwaveWebhookEvent).toHaveBeenCalledWith(
        event,
      );
      expect(result).toEqual({ received: true });
    });

    it('accepts the request when the verif-hash header matches the configured secret', async () => {
      process.env.FLW_WEBHOOK_HASH = 'configured-secret-hash';
      const event = { event: 'charge.completed', data: {} };
      const result = await controller.flutterwaveWebhook(
        'configured-secret-hash',
        makeRawBodyRequest(event),
      );
      expect(paymentService.flutterwaveWebhookEvent).toHaveBeenCalledWith(
        event,
      );
      expect(result).toEqual({ received: true });
    });

    it('throws UnauthorizedException and does not call the service when verif-hash does not match', async () => {
      process.env.FLW_WEBHOOK_HASH = 'configured-secret-hash';
      const event = { event: 'charge.completed', data: {} };

      await expect(
        controller.flutterwaveWebhook('wrong-hash', makeRawBodyRequest(event)),
      ).rejects.toThrow(UnauthorizedException);
      expect(paymentService.flutterwaveWebhookEvent).not.toHaveBeenCalled();
    });
  });
});
