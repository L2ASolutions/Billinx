/// <reference types="jest" />

import { WebhookController } from './webhook.controller';
import { WebhookService } from './services/webhook.service';
import { WEBHOOK_EVENT_TYPES } from '../../../packages/types/webhook';

const TENANT_ID = 'tenant-001';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

// Importing WebhookController pulls in the real WebhookService module, which
// imports webhook.queue.ts — that file constructs a real BullMQ Queue (and a
// real Redis connection) at import time. Mock it so this spec never opens a
// live connection Jest then can't tear down.
jest.mock('./queues/webhook.queue', () => ({
  addToWebhookQueue: jest.fn().mockResolvedValue(undefined),
}));

describe('WebhookController', () => {
  let controller: WebhookController;
  let webhookService: jest.Mocked<
    Pick<
      WebhookService,
      | 'createSubscription'
      | 'listSubscriptions'
      | 'getSubscription'
      | 'updateSubscription'
      | 'deleteSubscription'
      | 'listDeliveries'
      | 'getDelivery'
      | 'retryDelivery'
    >
  >;

  beforeEach(() => {
    webhookService = {
      createSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      listSubscriptions: jest.fn().mockResolvedValue([{ id: 'sub-1' }]),
      getSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      updateSubscription: jest
        .fn()
        .mockResolvedValue({ id: 'sub-1', isActive: false }),
      deleteSubscription: jest.fn().mockResolvedValue(undefined),
      listDeliveries: jest.fn().mockResolvedValue([{ id: 'del-1' }]),
      getDelivery: jest.fn().mockResolvedValue({ id: 'del-1' }),
      retryDelivery: jest
        .fn()
        .mockResolvedValue({ id: 'del-1', status: 'PENDING' }),
    };
    controller = new WebhookController(
      webhookService as unknown as WebhookService,
    );
  });

  it('createSubscription reads tenantId from request context and delegates the body', async () => {
    const body = {
      url: 'https://example.com/x',
      eventTypes: ['invoice.created'],
    } as any;
    const result = await controller.createSubscription(body);
    expect(webhookService.createSubscription).toHaveBeenCalledWith(
      TENANT_ID,
      body,
    );
    expect(result).toEqual({ id: 'sub-1' });
  });

  it('listSubscriptions delegates with the tenantId from context', async () => {
    await controller.listSubscriptions();
    expect(webhookService.listSubscriptions).toHaveBeenCalledWith(TENANT_ID);
  });

  it('getSubscription delegates the id param and tenantId', async () => {
    await controller.getSubscription('sub-1');
    expect(webhookService.getSubscription).toHaveBeenCalledWith(
      'sub-1',
      TENANT_ID,
    );
  });

  it('updateSubscription delegates the id, tenantId, and body', async () => {
    const body = { isActive: false };
    const result = await controller.updateSubscription('sub-1', body);
    expect(webhookService.updateSubscription).toHaveBeenCalledWith(
      'sub-1',
      TENANT_ID,
      body,
    );
    expect(result.isActive).toBe(false);
  });

  it('deleteSubscription delegates the id and tenantId', async () => {
    await controller.deleteSubscription('sub-1');
    expect(webhookService.deleteSubscription).toHaveBeenCalledWith(
      'sub-1',
      TENANT_ID,
    );
  });

  it('listDeliveries delegates the tenantId and optional status filter', async () => {
    await controller.listDeliveries('FAILED');
    expect(webhookService.listDeliveries).toHaveBeenCalledWith(
      TENANT_ID,
      'FAILED',
    );
  });

  it('getDelivery delegates the id and tenantId', async () => {
    await controller.getDelivery('del-1');
    expect(webhookService.getDelivery).toHaveBeenCalledWith('del-1', TENANT_ID);
  });

  it('retryDelivery delegates the id and tenantId', async () => {
    const result = await controller.retryDelivery('del-1');
    expect(webhookService.retryDelivery).toHaveBeenCalledWith(
      'del-1',
      TENANT_ID,
    );
    expect(result.status).toBe('PENDING');
  });

  it('listEventTypes returns the static list of supported webhook event types', async () => {
    const result = await controller.listEventTypes();
    expect(result).toEqual({ eventTypes: WEBHOOK_EVENT_TYPES });
  });
});
