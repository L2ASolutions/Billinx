/// <reference types="jest" />

import * as crypto from 'crypto';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { addToWebhookQueue } from '../queues/webhook.queue';

jest.mock('../../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

jest.mock('../queues/webhook.queue', () => ({
  addToWebhookQueue: jest.fn().mockResolvedValue(undefined),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const MASTER_KEY = Buffer.alloc(32, 1);
const SIGNING_KEY_HEX = 'a'.repeat(64); // 32 bytes hex

function makeSubscriptionRecord(overrides: Record<string, any> = {}): any {
  return {
    id: 'sub-1',
    tenantId: TENANT_ID,
    url: 'https://example.com/webhook',
    signingKey: Buffer.from('encrypted-key'),
    signingIv: Buffer.from('iv-bytes'),
    eventTypes: ['invoice.created'],
    isActive: true,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDeliveryRecord(overrides: Record<string, any> = {}): any {
  return {
    id: 'del-1',
    subscriptionId: 'sub-1',
    tenantId: TENANT_ID,
    eventType: 'invoice.created',
    eventId: 'evt-1',
    status: 'PENDING',
    attemptCount: 0,
    payload: {
      id: 'evt-1',
      type: 'invoice.created',
      tenantId: TENANT_ID,
      data: {},
    },
    lastAttemptAt: null,
    nextRetryAt: null,
    lastResponseCode: null,
    lastResponseBody: null,
    deliveredAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    subscription: makeSubscriptionRecord(),
    ...overrides,
  };
}

function makeRepository(overrides: Record<string, any> = {}) {
  return {
    createSubscription: jest.fn().mockResolvedValue(makeSubscriptionRecord()),
    findSubscriptionById: jest.fn().mockResolvedValue(makeSubscriptionRecord()),
    findSubscriptionsByTenant: jest
      .fn()
      .mockResolvedValue([makeSubscriptionRecord()]),
    findActiveSubscriptionsForEvent: jest
      .fn()
      .mockResolvedValue([makeSubscriptionRecord()]),
    updateSubscription: jest
      .fn()
      .mockImplementation((_id: string, data: any) =>
        Promise.resolve({ ...makeSubscriptionRecord(), ...data }),
      ),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
    createDelivery: jest.fn().mockResolvedValue(makeDeliveryRecord()),
    findDeliveryById: jest.fn().mockResolvedValue(makeDeliveryRecord()),
    findDeliveriesByTenant: jest.fn().mockResolvedValue([makeDeliveryRecord()]),
    updateDelivery: jest
      .fn()
      .mockImplementation((_id: string, data: any) =>
        Promise.resolve({ ...makeDeliveryRecord(), ...data }),
      ),
    ...overrides,
  };
}

describe('WebhookService', () => {
  let service: WebhookService;
  let repository: ReturnType<typeof makeRepository>;
  let credentialService: { encrypt: jest.Mock; decrypt: jest.Mock };
  let secretsService: { getMasterEncryptionKey: jest.Mock };
  let activityService: { track: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    repository = makeRepository();
    credentialService = {
      encrypt: jest.fn().mockReturnValue({
        encrypted: Buffer.from('encrypted-signing-key'),
        iv: Buffer.from('iv-bytes'),
      }),
      decrypt: jest.fn().mockReturnValue(SIGNING_KEY_HEX),
    };
    secretsService = {
      getMasterEncryptionKey: jest.fn().mockResolvedValue(MASTER_KEY),
    };
    activityService = { track: jest.fn() };
    service = new WebhookService(
      repository as any,
      credentialService as any,
      secretsService as any,
      activityService as any,
    );
  });

  // ── createSubscription ───────────────────────────────────────────────────

  describe('createSubscription', () => {
    const validRequest = {
      url: 'https://example.com/hook',
      eventTypes: ['invoice.created'] as any,
      description: 'my hook',
    };

    it('creates a subscription with an encrypted signing key and tracks activity', async () => {
      const result = await service.createSubscription(TENANT_ID, validRequest);

      expect(secretsService.getMasterEncryptionKey).toHaveBeenCalled();
      expect(credentialService.encrypt).toHaveBeenCalledWith(
        expect.stringMatching(/^[0-9a-f]{64}$/),
        MASTER_KEY,
        TENANT_ID,
      );
      expect(repository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          url: validRequest.url,
          eventTypes: validRequest.eventTypes,
          signingKey: Buffer.from('encrypted-signing-key'),
          signingIv: Buffer.from('iv-bytes'),
        }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          eventType: 'WEBHOOK_CREATED',
        }),
      );
      expect(result.id).toBe('sub-1');
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('rejects a non-URL string', async () => {
      await expect(
        service.createSubscription(TENANT_ID, {
          ...validRequest,
          url: 'not-a-url',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-HTTPS URL', async () => {
      await expect(
        service.createSubscription(TENANT_ID, {
          ...validRequest,
          url: 'http://example.com/hook',
        }),
      ).rejects.toThrow('Webhook URL must use HTTPS');
    });

    it.each([
      'https://localhost/hook',
      'https://0.0.0.0/hook',
      'https://internal-service.local/hook',
      'https://service.internal/hook',
      'https://10.0.0.1/hook',
      'https://127.0.0.1/hook',
      'https://169.254.169.254/hook', // AWS metadata endpoint
      'https://172.16.0.1/hook',
      'https://172.31.255.255/hook',
      'https://192.168.1.1/hook',
      'https://[::1]/hook',
      'https://[fc00::1]/hook',
      'https://[fd12::1]/hook',
      'https://[fe80::1]/hook',
    ])('rejects a private/reserved address: %s', async (url) => {
      await expect(
        service.createSubscription(TENANT_ID, { ...validRequest, url }),
      ).rejects.toThrow(
        'Webhook URL cannot target a private or reserved address',
      );
    });

    it.each([
      'https://example.com/hook',
      'https://8.8.8.8/hook',
      'https://203.0.113.5/hook',
      'https://172.15.0.1/hook', // just outside the private 172.16-31 range
      'https://172.32.0.1/hook', // just outside the private 172.16-31 range
      'https://[2001:db8::1]/hook',
    ])('accepts a public address: %s', async (url) => {
      await expect(
        service.createSubscription(TENANT_ID, { ...validRequest, url }),
      ).resolves.toBeDefined();
    });

    it('rejects an empty event types list', async () => {
      await expect(
        service.createSubscription(TENANT_ID, {
          ...validRequest,
          eventTypes: [] as any,
        }),
      ).rejects.toThrow('At least one event type is required');
    });

    it('rejects unknown event types', async () => {
      await expect(
        service.createSubscription(TENANT_ID, {
          ...validRequest,
          eventTypes: ['invoice.made_up'] as any,
        }),
      ).rejects.toThrow(/Invalid event types/);
    });
  });

  // ── listSubscriptions / getSubscription ──────────────────────────────────

  describe('listSubscriptions', () => {
    it('returns all subscriptions for the tenant, mapped', async () => {
      const result = await service.listSubscriptions(TENANT_ID);
      expect(repository.findSubscriptionsByTenant).toHaveBeenCalledWith(
        TENANT_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sub-1');
    });
  });

  describe('getSubscription', () => {
    it('returns the mapped subscription when owned by the tenant', async () => {
      const result = await service.getSubscription('sub-1', TENANT_ID);
      expect(result.id).toBe('sub-1');
    });

    it('throws NotFoundException when the subscription does not exist', async () => {
      repository.findSubscriptionById.mockResolvedValue(null);
      await expect(service.getSubscription('sub-1', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the subscription belongs to another tenant', async () => {
      repository.findSubscriptionById.mockResolvedValue(
        makeSubscriptionRecord({ tenantId: 'other-tenant' }),
      );
      await expect(service.getSubscription('sub-1', TENANT_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── updateSubscription ───────────────────────────────────────────────────

  describe('updateSubscription', () => {
    it('checks ownership before updating', async () => {
      repository.findSubscriptionById.mockResolvedValue(
        makeSubscriptionRecord({ tenantId: 'other-tenant' }),
      );
      await expect(
        service.updateSubscription('sub-1', TENANT_ID, { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.updateSubscription).not.toHaveBeenCalled();
    });

    it('validates a new URL when provided', async () => {
      await expect(
        service.updateSubscription('sub-1', TENANT_ID, {
          url: 'http://insecure.com',
        }),
      ).rejects.toThrow('Webhook URL must use HTTPS');
    });

    it('validates new event types when provided', async () => {
      await expect(
        service.updateSubscription('sub-1', TENANT_ID, {
          eventTypes: [] as any,
        }),
      ).rejects.toThrow('At least one event type is required');
    });

    it('updates and returns the mapped subscription', async () => {
      const result = await service.updateSubscription('sub-1', TENANT_ID, {
        isActive: false,
      });
      expect(repository.updateSubscription).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ isActive: false }),
      );
      expect(result.isActive).toBe(false);
    });
  });

  // ── deleteSubscription ───────────────────────────────────────────────────

  describe('deleteSubscription', () => {
    it('checks ownership before deleting', async () => {
      repository.findSubscriptionById.mockResolvedValue(null);
      await expect(
        service.deleteSubscription('sub-1', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
      expect(repository.deleteSubscription).not.toHaveBeenCalled();
    });

    it('deletes the subscription once ownership is confirmed', async () => {
      await service.deleteSubscription('sub-1', TENANT_ID);
      expect(repository.deleteSubscription).toHaveBeenCalledWith('sub-1');
    });
  });

  // ── listDeliveries / getDelivery ─────────────────────────────────────────

  describe('listDeliveries', () => {
    it('passes the status filter through to the repository', async () => {
      await service.listDeliveries(TENANT_ID, 'FAILED');
      expect(repository.findDeliveriesByTenant).toHaveBeenCalledWith(
        TENANT_ID,
        'FAILED',
      );
    });
  });

  describe('getDelivery', () => {
    it('returns the mapped delivery when owned by the tenant', async () => {
      const result = await service.getDelivery('del-1', TENANT_ID);
      expect(result.id).toBe('del-1');
    });

    it('throws NotFoundException when the delivery does not exist', async () => {
      repository.findDeliveryById.mockResolvedValue(null);
      await expect(service.getDelivery('del-1', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the delivery belongs to another tenant', async () => {
      repository.findDeliveryById.mockResolvedValue(
        makeDeliveryRecord({ tenantId: 'other-tenant' }),
      );
      await expect(service.getDelivery('del-1', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── retryDelivery ─────────────────────────────────────────────────────────

  describe('retryDelivery', () => {
    it('throws NotFoundException when the delivery does not exist or belongs to another tenant', async () => {
      repository.findDeliveryById.mockResolvedValue(null);
      await expect(service.retryDelivery('del-1', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the delivery already succeeded', async () => {
      repository.findDeliveryById.mockResolvedValue(
        makeDeliveryRecord({ status: 'DELIVERED' }),
      );
      await expect(service.retryDelivery('del-1', TENANT_ID)).rejects.toThrow(
        'Delivery already succeeded',
      );
    });

    it('resets the delivery to PENDING and re-enqueues it', async () => {
      repository.findDeliveryById
        .mockResolvedValueOnce(makeDeliveryRecord({ status: 'DEAD_LETTERED' }))
        .mockResolvedValueOnce(
          makeDeliveryRecord({ status: 'PENDING', attemptCount: 0 }),
        );

      const result = await service.retryDelivery('del-1', TENANT_ID);

      expect(repository.updateDelivery).toHaveBeenCalledWith('del-1', {
        status: 'PENDING',
        attemptCount: 0,
        nextRetryAt: null,
      });
      expect(addToWebhookQueue).toHaveBeenCalledWith({ deliveryId: 'del-1' });
      expect(result.status).toBe('PENDING');
    });
  });

  // ── Event dispatch ────────────────────────────────────────────────────────

  describe('event dispatch (onInvoiceCreated etc.)', () => {
    it('does nothing when there are no active subscriptions for the event', async () => {
      repository.findActiveSubscriptionsForEvent.mockResolvedValue([]);
      await service.onInvoiceCreated({
        tenantId: TENANT_ID,
        eventType: 'invoice.created',
        invoiceId: 'inv-1',
        platformIrn: 'IRN-1',
        data: {},
      });
      expect(repository.createDelivery).not.toHaveBeenCalled();
      expect(addToWebhookQueue).not.toHaveBeenCalled();
    });

    it('creates a delivery and enqueues it for each active subscription', async () => {
      repository.findActiveSubscriptionsForEvent.mockResolvedValue([
        makeSubscriptionRecord({ id: 'sub-1' }),
        makeSubscriptionRecord({ id: 'sub-2' }),
      ]);
      repository.createDelivery.mockImplementation((data: any) =>
        Promise.resolve(
          makeDeliveryRecord({ id: `del-${data.subscriptionId}`, ...data }),
        ),
      );

      await service.onInvoiceAccepted({
        tenantId: TENANT_ID,
        eventType: 'invoice.accepted',
        invoiceId: 'inv-1',
        platformIrn: 'IRN-1',
        data: { foo: 'bar' },
      });

      expect(repository.createDelivery).toHaveBeenCalledTimes(2);
      expect(addToWebhookQueue).toHaveBeenCalledWith({
        deliveryId: 'del-sub-1',
      });
      expect(addToWebhookQueue).toHaveBeenCalledWith({
        deliveryId: 'del-sub-2',
      });
    });

    it('swallows errors so a dispatch failure does not crash the event listener', async () => {
      repository.findActiveSubscriptionsForEvent.mockRejectedValue(
        new Error('db down'),
      );
      await expect(
        service.onInvoiceRejected({
          tenantId: TENANT_ID,
          eventType: 'invoice.rejected',
          invoiceId: 'inv-1',
          platformIrn: 'IRN-1',
          data: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── processDelivery (worker entry point) ─────────────────────────────────

  describe('processDelivery', () => {
    const ORIGINAL_FETCH = global.fetch;

    afterEach(() => {
      global.fetch = ORIGINAL_FETCH;
    });

    it('throws when the delivery does not exist', async () => {
      repository.findDeliveryById.mockResolvedValue(null);
      await expect(service.processDelivery('del-1', 0)).rejects.toThrow(
        'Delivery del-1 not found',
      );
    });

    it('decrypts the signing key using the subscription tenant and master key', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ status: 200, text: async () => 'ok' });
      await service.processDelivery('del-1', 0);
      expect(secretsService.getMasterEncryptionKey).toHaveBeenCalled();
      expect(credentialService.decrypt).toHaveBeenCalledWith(
        Buffer.from(makeSubscriptionRecord().signingKey),
        Buffer.from(makeSubscriptionRecord().signingIv),
        MASTER_KEY,
        TENANT_ID,
      );
    });

    it('sends a correctly HMAC-SHA256-signed request with the expected headers', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: async () => 'ok' });
      global.fetch = fetchMock;

      await service.processDelivery('del-1', 0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.com/webhook');
      expect(init.method).toBe('POST');
      expect(init.headers['X-Billinx-Event']).toBe('invoice.created');
      expect(init.headers['X-Billinx-Delivery']).toBe('del-1');
      expect(init.headers['X-Billinx-Signature']).toMatch(
        /^sha256=[0-9a-f]{64}$/,
      );

      const expectedSignature = crypto
        .createHmac('sha256', Buffer.from(SIGNING_KEY_HEX, 'hex'))
        .update(init.body)
        .digest('hex');
      expect(init.headers['X-Billinx-Signature']).toBe(
        `sha256=${expectedSignature}`,
      );
    });

    it('marks the delivery DELIVERED on a 2xx response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ status: 204, text: async () => '' });

      await service.processDelivery('del-1', 0);

      expect(repository.updateDelivery).toHaveBeenCalledWith(
        'del-1',
        expect.objectContaining({ status: 'DELIVERED', lastResponseCode: 204 }),
      );
    });

    it('marks the delivery FAILED and throws (to trigger a BullMQ retry) on a non-2xx response, when attempts remain', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ status: 500, text: async () => 'server error' });

      await expect(service.processDelivery('del-1', 0)).rejects.toThrow(
        'HTTP 500: server error',
      );

      expect(repository.updateDelivery).toHaveBeenCalledWith(
        'del-1',
        expect.objectContaining({
          status: 'FAILED',
          nextRetryAt: expect.any(Date),
        }),
      );
    });

    it('dead-letters the delivery without throwing once the final attempt fails', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ status: 500, text: async () => 'server error' });

      // MAX_ATTEMPTS = 3 -> isLastAttempt when attemptsMade >= 2
      await expect(
        service.processDelivery('del-1', 2),
      ).resolves.toBeUndefined();

      expect(repository.updateDelivery).toHaveBeenCalledWith(
        'del-1',
        expect.objectContaining({ status: 'DEAD_LETTERED', nextRetryAt: null }),
      );
    });

    it('treats an aborted (timed-out) request as a failure with a friendly message', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(
        service.processDelivery('del-1', 2),
      ).resolves.toBeUndefined();

      expect(repository.updateDelivery).toHaveBeenCalledWith(
        'del-1',
        expect.objectContaining({
          status: 'DEAD_LETTERED',
          lastResponseBody: 'Request timed out',
        }),
      );
    });
  });
});
