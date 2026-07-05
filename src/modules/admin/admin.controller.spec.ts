/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './services/admin.service';
import { RecoveryService } from '../../shared/recovery/recovery.service';
import { ReminderService } from '../reminder/services/reminder.service';

function makeRequest(
  adminContext: Record<string, any> = { adminId: 'admin-1' },
) {
  return { _adminContext: adminContext } as any;
}

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: jest.Mocked<Partial<AdminService>>;
  let recoveryService: jest.Mocked<Partial<RecoveryService>>;
  let reminderService: jest.Mocked<Partial<ReminderService>>;

  beforeEach(() => {
    adminService = {
      createAdminUser: jest.fn().mockResolvedValue({ id: 'admin-1' }),
      listAdminUsers: jest.fn().mockResolvedValue([]),
      login: jest.fn().mockResolvedValue({ accessToken: 'token' }),
      getDashboardStats: jest.fn().mockResolvedValue({ tenants: {} }),
      listTenants: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getTenantDetail: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      listAccessRequests: jest.fn().mockResolvedValue([]),
      approveAndProvision: jest
        .fn()
        .mockResolvedValue({ tenantId: 'tenant-1' }),
      unlockAccount: jest.fn().mockResolvedValue({ message: 'unlocked' }),
      rejectAccessRequest: jest.fn().mockResolvedValue({ message: 'rejected' }),
      listConsentRecords: jest.fn().mockResolvedValue([]),
      listErasureRequests: jest.fn().mockResolvedValue([]),
      approveErasure: jest.fn().mockResolvedValue({ message: 'approved' }),
      rejectErasure: jest.fn().mockResolvedValue({ message: 'rejected' }),
      getMetrics: jest.fn().mockResolvedValue({}),
      getQueueStatus: jest.fn().mockResolvedValue({}),
      retryFailedJobs: jest.fn().mockResolvedValue({ retried: 0 }),
      getBulkQueueStatus: jest.fn().mockResolvedValue({}),
      getRetentionStats: jest.fn().mockResolvedValue({}),
      runRetention: jest.fn().mockResolvedValue({}),
      exportPlatformCSV: jest.fn().mockResolvedValue('csv'),
      verifyAuditChain: jest.fn().mockResolvedValue({ valid: true }),
    };
    recoveryService = {
      reconcileStuckInvoices: jest.fn().mockResolvedValue({ reset: 0 }),
    };
    reminderService = {
      runReminderCheck: jest.fn().mockResolvedValue({ processed: 0 }),
    };

    controller = new AdminController(
      adminService as any,
      recoveryService as any,
      reminderService as any,
    );
  });

  it('createAdminUser delegates the request body to the service', async () => {
    const body = { email: 'a@x.com' };
    await controller.createAdminUser(body);
    expect(adminService.createAdminUser).toHaveBeenCalledWith(body);
  });

  it('listAdminUsers delegates to the service', async () => {
    await controller.listAdminUsers();
    expect(adminService.listAdminUsers).toHaveBeenCalled();
  });

  it('login delegates the request body to the service', async () => {
    const body = { email: 'a@x.com', password: 'pw' };
    await controller.login(body);
    expect(adminService.login).toHaveBeenCalledWith(body);
  });

  it('getDashboard delegates to the service', async () => {
    await controller.getDashboard();
    expect(adminService.getDashboardStats).toHaveBeenCalled();
  });

  describe('listTenants', () => {
    it('converts page/limit query params to numbers', async () => {
      await controller.listTenants(2, 50);
      expect(adminService.listTenants).toHaveBeenCalledWith(2, 50);
    });

    it('defaults to page 1 / limit 20 when omitted', async () => {
      await controller.listTenants(undefined, undefined);
      expect(adminService.listTenants).toHaveBeenCalledWith(1, 20);
    });
  });

  it('getTenantDetail delegates the id param', async () => {
    await controller.getTenantDetail('tenant-1');
    expect(adminService.getTenantDetail).toHaveBeenCalledWith('tenant-1');
  });

  it('listAccessRequests delegates the status query param', async () => {
    await controller.listAccessRequests('PENDING');
    expect(adminService.listAccessRequests).toHaveBeenCalledWith('PENDING');
  });

  it('approveAndProvision pulls adminId from the request context set by AdminJwtGuard', async () => {
    const req = makeRequest({ adminId: 'admin-42' });
    const body = {
      appAdapterKey: 'mock',
      environment: 'SANDBOX',
      reviewNote: 'ok',
    };

    await controller.approveAndProvision('req-1', body, req);

    expect(adminService.approveAndProvision).toHaveBeenCalledWith(
      'req-1',
      'admin-42',
      { appAdapterKey: 'mock', environment: 'SANDBOX', reviewNote: 'ok' },
    );
  });

  it('unlockAccount delegates tenantId/email from the body', async () => {
    await controller.unlockAccount({ tenantId: 't1', email: 'u@x.com' });
    expect(adminService.unlockAccount).toHaveBeenCalledWith('t1', 'u@x.com');
  });

  it('rejectAccessRequest pulls adminId from the request context', async () => {
    const req = makeRequest({ adminId: 'admin-42' });
    await controller.rejectAccessRequest('req-1', { reviewNote: 'no' }, req);
    expect(adminService.rejectAccessRequest).toHaveBeenCalledWith(
      'req-1',
      'admin-42',
      'no',
    );
  });

  it('listConsentRecords delegates all query params', async () => {
    await controller.listConsentRecords(
      't1',
      'u@x.com',
      'NDPR_DATA_PROCESSING',
    );
    expect(adminService.listConsentRecords).toHaveBeenCalledWith({
      tenantId: 't1',
      email: 'u@x.com',
      consentType: 'NDPR_DATA_PROCESSING',
    });
  });

  it('listErasureRequests delegates the status query param', async () => {
    await controller.listErasureRequests('PENDING');
    expect(adminService.listErasureRequests).toHaveBeenCalledWith('PENDING');
  });

  it('approveErasure pulls adminId from the request context', async () => {
    const req = makeRequest({ adminId: 'admin-42' });
    await controller.approveErasure('erasure-1', { reviewNote: 'ok' }, req);
    expect(adminService.approveErasure).toHaveBeenCalledWith(
      'erasure-1',
      'admin-42',
      'ok',
    );
  });

  it('rejectErasure pulls adminId from the request context', async () => {
    const req = makeRequest({ adminId: 'admin-42' });
    await controller.rejectErasure('erasure-1', { reviewNote: 'no' }, req);
    expect(adminService.rejectErasure).toHaveBeenCalledWith(
      'erasure-1',
      'admin-42',
      'no',
    );
  });

  it('getMetrics delegates to the service', async () => {
    await controller.getMetrics();
    expect(adminService.getMetrics).toHaveBeenCalled();
  });

  it('getQueueStatus delegates to the service', async () => {
    await controller.getQueueStatus();
    expect(adminService.getQueueStatus).toHaveBeenCalled();
  });

  it('retryFailedJobs delegates to the service', async () => {
    await controller.retryFailedJobs();
    expect(adminService.retryFailedJobs).toHaveBeenCalled();
  });

  it('getBulkQueueStatus delegates to the service', async () => {
    await controller.getBulkQueueStatus();
    expect(adminService.getBulkQueueStatus).toHaveBeenCalled();
  });

  it('getRetentionStats delegates to the service', async () => {
    await controller.getRetentionStats();
    expect(adminService.getRetentionStats).toHaveBeenCalled();
  });

  it('runRetention delegates to the service', async () => {
    await controller.runRetention();
    expect(adminService.runRetention).toHaveBeenCalled();
  });

  describe('exportPlatformCSV', () => {
    it('throws BadRequestException when startDate or endDate is missing', async () => {
      await expect(
        controller.exportPlatformCSV('', '2026-01-31'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.exportPlatformCSV('2026-01-01', ''),
      ).rejects.toThrow(BadRequestException);
      expect(adminService.exportPlatformCSV).not.toHaveBeenCalled();
    });

    it('delegates to the service when both dates are provided', async () => {
      await controller.exportPlatformCSV('2026-01-01', '2026-01-31');
      expect(adminService.exportPlatformCSV).toHaveBeenCalledWith(
        '2026-01-01',
        '2026-01-31',
      );
    });
  });

  it('verifyAuditChain delegates to the service', async () => {
    await controller.verifyAuditChain();
    expect(adminService.verifyAuditChain).toHaveBeenCalled();
  });

  it('runRecovery delegates to RecoveryService (not AdminService)', async () => {
    await controller.runRecovery();
    expect(recoveryService.reconcileStuckInvoices).toHaveBeenCalled();
  });

  describe('runReminders', () => {
    it('delegates the optional tenantId to ReminderService', async () => {
      await controller.runReminders('tenant-1');
      expect(reminderService.runReminderCheck).toHaveBeenCalledWith('tenant-1');
    });

    it('passes undefined when no tenantId is given (platform-wide run)', async () => {
      await controller.runReminders(undefined);
      expect(reminderService.runReminderCheck).toHaveBeenCalledWith(undefined);
    });
  });
});
