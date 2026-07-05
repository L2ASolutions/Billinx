/// <reference types="jest" />

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

const TENANT_ID = 'tenant-001';
const ACTOR = 'user:user-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID, actor: ACTOR } };
}

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: jest.Mocked<
    Pick<NotificationService, 'findForUser' | 'markAllRead' | 'markRead'>
  >;

  beforeEach(() => {
    service = {
      findForUser: jest.fn().mockResolvedValue([]),
      markAllRead: jest.fn().mockResolvedValue(undefined),
      markRead: jest.fn().mockResolvedValue(undefined),
    };
    controller = new NotificationController(service as any);
  });

  it('list scopes the lookup to the caller tenant and actor', async () => {
    await controller.list(makeRequest());
    expect(service.findForUser).toHaveBeenCalledWith(TENANT_ID, ACTOR);
  });

  it('markAllRead scopes to the caller tenant/actor and confirms', async () => {
    const result = await controller.markAllRead(makeRequest());
    expect(service.markAllRead).toHaveBeenCalledWith(TENANT_ID, ACTOR);
    expect(result).toEqual({ ok: true });
  });

  it('markRead scopes to the caller tenant/actor and the given id, and confirms', async () => {
    const result = await controller.markRead('notif-1', makeRequest());
    expect(service.markRead).toHaveBeenCalledWith(TENANT_ID, ACTOR, 'notif-1');
    expect(result).toEqual({ ok: true });
  });
});
