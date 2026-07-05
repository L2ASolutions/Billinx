/// <reference types="jest" />

import { NotificationService } from './notification.service';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';

describe('NotificationService', () => {
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let service: NotificationService;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new NotificationService(prisma as any);
  });

  it('create persists the given notification fields', async () => {
    const data = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      type: 'INVOICE_ACCEPTED',
      title: 'Invoice accepted',
      body: 'Your invoice was accepted',
      link: '/invoices/1',
    };

    const result = await service.create(data);

    expect(prisma.notification.create).toHaveBeenCalledWith({ data });
    expect(result).toEqual({ id: 'notif-1' });
  });

  it('findForUser scopes to tenantId/userId, orders newest-first, and caps at 20', async () => {
    await service.findForUser(TENANT_ID, USER_ID);

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, userId: USER_ID },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  it('markRead scopes the update to id+tenantId+userId (prevents cross-tenant/user marking)', async () => {
    await service.markRead(TENANT_ID, USER_ID, 'notif-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', tenantId: TENANT_ID, userId: USER_ID },
      data: { read: true },
    });
  });

  it('markAllRead only updates currently-unread notifications for the tenant/user', async () => {
    await service.markAllRead(TENANT_ID, USER_ID);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, userId: USER_ID, read: false },
      data: { read: true },
    });
  });

  describe('hasUnreadOfTypeForPeriod', () => {
    it('returns true when a matching unread notification exists', async () => {
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.hasUnreadOfTypeForPeriod(
        USER_ID,
        'VAT_REMINDER',
        '2026-03',
      );

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          type: 'VAT_REMINDER',
          read: false,
          body: { contains: '2026-03' },
        },
      });
      expect(result).toBe(true);
    });

    it('returns false when no matching unread notification exists', async () => {
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.hasUnreadOfTypeForPeriod(
        USER_ID,
        'VAT_REMINDER',
        '2026-03',
      );

      expect(result).toBe(false);
    });
  });
});
