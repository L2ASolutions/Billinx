/// <reference types="jest" />

import { UpdateStatusWorker } from './update-status.worker';

describe('UpdateStatusWorker', () => {
  let interswitchAdapter: { updatePaymentStatus: jest.Mock };
  let prisma: { asAdmin: jest.Mock };
  let notificationService: { create: jest.Mock };
  let worker: UpdateStatusWorker;

  beforeEach(() => {
    interswitchAdapter = { updatePaymentStatus: jest.fn() };
    prisma = { asAdmin: jest.fn((fn: any) => fn({})) };
    notificationService = { create: jest.fn() };
    worker = new UpdateStatusWorker(
      interswitchAdapter as any,
      prisma as any,
      notificationService as any,
    );
  });

  describe('recordOutcome (private)', () => {
    it('writes lastNrsStatusUpdateAt/Success = true on success', async () => {
      const update = jest.fn();
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ invoice: { update } }),
      );

      await (worker as any).recordOutcome('invoice-1', true);

      expect(update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          lastNrsStatusUpdateAt: expect.any(Date),
          lastNrsStatusUpdateSuccess: true,
        },
      });
    });

    it('writes lastNrsStatusUpdateSuccess = false on failure', async () => {
      const update = jest.fn();
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ invoice: { update } }),
      );

      await (worker as any).recordOutcome('invoice-1', false);

      expect(update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          lastNrsStatusUpdateAt: expect.any(Date),
          lastNrsStatusUpdateSuccess: false,
        },
      });
    });
  });

  describe('notifyTenant (private)', () => {
    const jobData = {
      invoiceId: 'invoice-1',
      tenantId: 'tenant-1',
      irn: 'IRN-1',
      status: 'PAID' as const,
    };

    it('creates a notification for the active OWNER user', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          userRole: {
            findFirst: jest.fn().mockResolvedValue({
              user: { id: 'user-1', isActive: true },
            }),
          },
        }),
      );

      await (worker as any).notifyTenant(jobData);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          type: 'nrs_status_update_failed',
          link: '/invoices/invoice-1',
        }),
      );
    });

    it('does nothing when there is no active OWNER user', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({ userRole: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await (worker as any).notifyTenant(jobData);

      expect(notificationService.create).not.toHaveBeenCalled();
    });

    it('does nothing when the OWNER user is inactive', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          userRole: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ user: { id: 'user-1', isActive: false } }),
          },
        }),
      );

      await (worker as any).notifyTenant(jobData);

      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });
});
