/// <reference types="jest" />

import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminService } from './admin.service';

jest.mock('../../submission/queues/submission.queue', () => ({
  getSubmissionQueue: jest.fn(),
}));
jest.mock('../../submission/queues/bulk-submission.queue', () => ({
  getBulkSubmissionQueue: jest.fn(),
}));

import { getSubmissionQueue } from '../../submission/queues/submission.queue';
import { getBulkSubmissionQueue } from '../../submission/queues/bulk-submission.queue';

function makePrisma(tx: Record<string, any>) {
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('AdminService', () => {
  let tx: Record<string, any>;
  let prisma: ReturnType<typeof makePrisma>;
  let redisService: { clearLoginFailures: jest.Mock };
  let emailService: { sendAccessRequestApproved: jest.Mock };
  let consentService: {
    listAll: jest.Mock;
    listErasureRequests: jest.Mock;
    approveErasure: jest.Mock;
    rejectErasure: jest.Mock;
  };
  let retentionService: {
    getRetentionStats: jest.Mock;
    archiveOldInvoices: jest.Mock;
    archiveOldActivityEvents: jest.Mock;
  };
  let exportService: { exportPlatformCSV: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    tx = {
      adminUser: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      invoice: {
        count: jest.fn().mockResolvedValue(0),
      },
      accessRequest: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      systemError: {
        count: jest.fn().mockResolvedValue(0),
      },
      webhookDelivery: {
        count: jest.fn().mockResolvedValue(0),
      },
      activityEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = makePrisma(tx);
    redisService = {
      clearLoginFailures: jest.fn().mockResolvedValue(undefined),
    };
    emailService = { sendAccessRequestApproved: jest.fn() };
    consentService = {
      listAll: jest.fn().mockResolvedValue([]),
      listErasureRequests: jest.fn().mockResolvedValue([]),
      approveErasure: jest.fn().mockResolvedValue({ message: 'approved' }),
      rejectErasure: jest.fn().mockResolvedValue({ message: 'rejected' }),
    };
    retentionService = {
      getRetentionStats: jest.fn().mockResolvedValue({ stats: true }),
      archiveOldInvoices: jest.fn().mockResolvedValue({ archived: 3 }),
      archiveOldActivityEvents: jest.fn().mockResolvedValue({ archived: 5 }),
    };
    exportService = {
      exportPlatformCSV: jest.fn().mockResolvedValue('csv-content'),
    };

    service = new AdminService(
      prisma as any,
      redisService as any,
      emailService as any,
      consentService as any,
      retentionService as any,
      exportService as any,
    );

    (getSubmissionQueue as jest.Mock).mockReset();
    (getBulkSubmissionQueue as jest.Mock).mockReset();
  });

  describe('createAdminUser', () => {
    it('throws ConflictException when the email is already registered', async () => {
      tx.adminUser.findUnique.mockResolvedValue({ id: 'admin-1' });

      await expect(
        service.createAdminUser({
          email: 'staff@l2asolutions.com',
          password: 'pw',
          firstName: 'A',
          lastName: 'B',
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(tx.adminUser.create).not.toHaveBeenCalled();
    });

    it('defaults role to STAFF and hashes the password before storing', async () => {
      tx.adminUser.create.mockResolvedValue({
        id: 'admin-1',
        email: 'staff@l2asolutions.com',
        firstName: 'A',
        lastName: 'B',
        role: 'STAFF',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.createAdminUser({
        email: 'staff@l2asolutions.com',
        password: 'plaintext-pw',
        firstName: 'A',
        lastName: 'B',
      });

      const createCall = tx.adminUser.create.mock.calls[0][0];
      expect(createCall.data.role).toBe('STAFF');
      expect(createCall.data.passwordHash).not.toBe('plaintext-pw');
      expect(result.email).toBe('staff@l2asolutions.com');
      expect(result.fullName).toBe('A B');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException when no admin matches the email', async () => {
      tx.adminUser.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'missing@x.com', password: 'pw' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the admin is deactivated', async () => {
      tx.adminUser.findUnique.mockResolvedValue({ isActive: false });
      await expect(
        service.login({ email: 'staff@x.com', password: 'pw' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      const passwordHash = await bcrypt.hash('correct-pw', 4);
      tx.adminUser.findUnique.mockResolvedValue({
        id: 'admin-1',
        isActive: true,
        passwordHash,
      });

      await expect(
        service.login({ email: 'staff@x.com', password: 'wrong-pw' } as any),
      ).rejects.toThrow(UnauthorizedException);
      expect(tx.adminUser.update).not.toHaveBeenCalled();
    });

    it('updates lastLoginAt and returns a signed bearer token on success', async () => {
      const passwordHash = await bcrypt.hash('correct-pw', 4);
      tx.adminUser.findUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'staff@x.com',
        firstName: 'A',
        lastName: 'B',
        role: 'SUPER_ADMIN',
        isActive: true,
        passwordHash,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.login({
        email: 'staff@x.com',
        password: 'correct-pw',
      });

      expect(tx.adminUser.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(8 * 60 * 60);

      const decoded = jwt.decode(result.accessToken) as any;
      expect(decoded.sub).toBe('admin-1');
      expect(decoded.isAdmin).toBe(true);
      expect(decoded.role).toBe('SUPER_ADMIN');
    });
  });

  describe('getDashboardStats', () => {
    it('computes a 0% acceptance rate when there are no invoices', async () => {
      const result = await service.getDashboardStats();
      expect(result.invoices.acceptanceRate).toBe(0);
    });

    it('computes acceptance rate as a rounded percentage', async () => {
      tx.invoice.count = jest
        .fn()
        .mockResolvedValueOnce(3) // total
        .mockResolvedValueOnce(1) // today
        .mockResolvedValueOnce(2) // accepted
        .mockResolvedValueOnce(1) // rejected
        .mockResolvedValueOnce(0); // pending

      const result = await service.getDashboardStats();
      expect(result.invoices.total).toBe(3);
      expect(result.invoices.acceptanceRate).toBe(67);
    });
  });

  describe('listTenants', () => {
    it('maps tenants with invoice/user counts and computes skip from page/limit', async () => {
      tx.tenant.findMany.mockResolvedValue([
        {
          id: 'tenant-1',
          name: 'Acme',
          tin: 'TIN1',
          environment: 'SANDBOX',
          rateLimitTier: 'STANDARD',
          appAdapterKey: 'mock',
          isActive: true,
          _count: { invoices: 5, users: 2 },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      tx.tenant.count.mockResolvedValue(1);

      const result = await service.listTenants(2, 10);

      expect(tx.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.data[0]).toMatchObject({
        id: 'tenant-1',
        invoiceCount: 5,
        userCount: 2,
      });
      expect(result.total).toBe(1);
    });
  });

  describe('getTenantDetail', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      tx.tenant.findUnique.mockResolvedValue(null);
      await expect(service.getTenantDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns tenant detail with user list and acceptance rate', async () => {
      tx.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme',
        tin: 'TIN1',
        environment: 'SANDBOX',
        isActive: true,
        appAdapterKey: 'mock',
        rateLimitTier: 'STANDARD',
        registeredAddress: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        users: [
          {
            id: 'user-1',
            email: 'u@x.com',
            firstName: 'U',
            lastName: 'Ser',
            roles: [{ role: 'OWNER' }],
            isActive: true,
            mfaEnabled: true,
            lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
        _count: { invoices: 4 },
      });
      tx.invoice.count
        .mockResolvedValueOnce(3) // accepted
        .mockResolvedValueOnce(1); // rejected

      const result = await service.getTenantDetail('tenant-1');

      expect(result.users[0].roles).toEqual(['OWNER']);
      expect(result.stats).toEqual({
        total: 4,
        accepted: 3,
        rejected: 1,
        acceptanceRate: 75,
      });
    });
  });

  describe('approveAndProvision', () => {
    it('throws NotFoundException when the access request does not exist', async () => {
      tx.accessRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.approveAndProvision('missing', 'admin-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a tenant, marks the request approved, and emails the applicant', async () => {
      tx.accessRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme Ltd',
        tin: 'TIN1',
        email: 'owner@acme.com',
        contactName: 'Owner Name',
      });
      tx.tenant.create.mockResolvedValue({
        id: 'tenant-new',
        name: 'Acme Ltd',
      });

      const result = await service.approveAndProvision('req-1', 'admin-1', {
        appAdapterKey: 'interswitch',
        environment: 'PRODUCTION',
        reviewNote: 'looks good',
      });

      expect(tx.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Acme Ltd',
            tin: 'TIN1',
            appAdapterKey: 'interswitch',
            environment: 'PRODUCTION',
          }),
        }),
      );
      expect(tx.accessRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: 'APPROVED',
          reviewedBy: 'admin-1',
          reviewedAt: expect.any(Date),
          reviewNote: 'looks good',
        },
      });
      expect(emailService.sendAccessRequestApproved).toHaveBeenCalledWith({
        to: 'owner@acme.com',
        contactName: 'Owner Name',
        companyName: 'Acme Ltd',
      });
      expect(result.tenantId).toBe('tenant-new');
    });

    it('defaults appAdapterKey to mock and environment to SANDBOX when not provided', async () => {
      tx.accessRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme Ltd',
        tin: 'TIN1',
        email: 'owner@acme.com',
        contactName: 'Owner Name',
      });
      tx.tenant.create.mockResolvedValue({
        id: 'tenant-new',
        name: 'Acme Ltd',
      });

      await service.approveAndProvision('req-1', 'admin-1', {});

      expect(tx.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            appAdapterKey: 'mock',
            environment: 'SANDBOX',
          }),
        }),
      );
    });
  });

  describe('listAccessRequests', () => {
    it('filters by status when provided', async () => {
      await service.listAccessRequests('PENDING');
      expect(tx.accessRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    it('does not filter when status is omitted', async () => {
      await service.listAccessRequests();
      expect(tx.accessRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('maps kybVerification to null when absent, and to a full object when present', async () => {
      tx.accessRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          companyName: 'Acme',
          tin: 'TIN1',
          contactName: 'Owner',
          email: 'o@acme.com',
          phone: '+234',
          estimatedVolume: 100,
          useCase: 'invoicing',
          status: 'PENDING',
          cacRcNumber: 'RC1',
          kybScore: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          kybVerification: null,
        },
        {
          id: 'req-2',
          companyName: 'Beta',
          tin: 'TIN2',
          contactName: 'Owner2',
          email: 'o2@beta.com',
          phone: '+234',
          estimatedVolume: 50,
          useCase: 'invoicing',
          status: 'PENDING',
          cacRcNumber: 'RC2',
          kybScore: 80,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          kybVerification: {
            id: 'kyb-1',
            tinUserConfirmed: true,
            tinConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
            tinProofNote: null,
            cacVerified: true,
            cacCompanyName: 'Beta',
            cacStatus: 'ACTIVE',
            cacRegistrationDate: '2020-01-01',
            cacDirectors: [],
            nameMatchScore: 95,
            nameMatchResult: 'MATCH',
            riskScore: 'GREEN',
            riskReasons: [],
            cacErrorMessage: null,
          },
        },
      ]);

      const result = await service.listAccessRequests();
      expect(result[0].kybVerification).toBeNull();
      expect(result[1].kybVerification).toMatchObject({
        id: 'kyb-1',
        riskScore: 'GREEN',
      });
    });
  });

  describe('rejectAccessRequest', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      tx.accessRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.rejectAccessRequest('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('marks the request rejected with the reviewer and note', async () => {
      tx.accessRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme Ltd',
      });

      const result = await service.rejectAccessRequest(
        'req-1',
        'admin-1',
        'not eligible',
      );

      expect(tx.accessRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: 'REJECTED',
          reviewedBy: 'admin-1',
          reviewedAt: expect.any(Date),
          reviewNote: 'not eligible',
        },
      });
      expect(result.message).toContain('Acme Ltd');
    });
  });

  it('unlockAccount clears login failures via RedisService', async () => {
    const result = await service.unlockAccount('tenant-1', 'user@x.com');
    expect(redisService.clearLoginFailures).toHaveBeenCalledWith(
      'tenant-1',
      'user@x.com',
    );
    expect(result.message).toContain('user@x.com');
  });

  it('listAdminUsers maps stored admin rows to the response shape', async () => {
    tx.adminUser.findMany.mockResolvedValue([
      {
        id: 'admin-1',
        email: 'staff@x.com',
        firstName: 'A',
        lastName: 'B',
        role: 'STAFF',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.listAdminUsers();
    expect(result[0].fullName).toBe('A B');
  });

  describe('delegated consent/erasure methods', () => {
    it('listConsentRecords delegates to ConsentService', async () => {
      await service.listConsentRecords({ tenantId: 't1' });
      expect(consentService.listAll).toHaveBeenCalledWith({ tenantId: 't1' });
    });

    it('listErasureRequests delegates to ConsentService', async () => {
      await service.listErasureRequests('PENDING');
      expect(consentService.listErasureRequests).toHaveBeenCalledWith(
        'PENDING',
      );
    });

    it('approveErasure delegates to ConsentService', async () => {
      await service.approveErasure('req-1', 'admin-1', 'note');
      expect(consentService.approveErasure).toHaveBeenCalledWith(
        'req-1',
        'admin-1',
        'note',
      );
    });

    it('rejectErasure delegates to ConsentService', async () => {
      await service.rejectErasure('req-1', 'admin-1', 'note');
      expect(consentService.rejectErasure).toHaveBeenCalledWith(
        'req-1',
        'admin-1',
        'note',
      );
    });
  });

  describe('getMetrics', () => {
    it('computes acceptance rates for today/week/month, defaulting to 0 when totals are 0', async () => {
      tx.invoice.count
        .mockResolvedValueOnce(0) // todayTotal
        .mockResolvedValueOnce(0) // todayAccepted
        .mockResolvedValueOnce(4) // weekTotal
        .mockResolvedValueOnce(2) // weekAccepted
        .mockResolvedValueOnce(10) // monthTotal
        .mockResolvedValueOnce(5); // monthAccepted
      tx.tenant.count.mockResolvedValue(7);
      tx.systemError.count.mockResolvedValue(2);
      tx.webhookDelivery.count
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(18); // delivered

      const result = await service.getMetrics();

      expect(result.invoices.today.acceptanceRate).toBe(0);
      expect(result.invoices.week.acceptanceRate).toBe(50);
      expect(result.invoices.month.acceptanceRate).toBe(50);
      expect(result.activeTenants).toBe(7);
      expect(result.errors.last24h).toBe(2);
      expect(result.webhooks.successRate).toBe(90);
    });
  });

  describe('queue monitoring', () => {
    it('getQueueStatus returns job counts from the submission queue', async () => {
      (getSubmissionQueue as jest.Mock).mockReturnValue({
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 1,
          active: 2,
          completed: 3,
          failed: 4,
          delayed: 5,
        }),
      });

      const result = await service.getQueueStatus();
      expect(result).toEqual({
        waiting: 1,
        active: 2,
        completed: 3,
        failed: 4,
        delayed: 5,
      });
    });

    it('getQueueStatus returns zeroed counts plus an error message if the queue throws', async () => {
      (getSubmissionQueue as jest.Mock).mockImplementation(() => {
        throw new Error('redis down');
      });

      const result = await service.getQueueStatus();
      expect(result.error).toBe('redis down');
      expect(result.waiting).toBe(0);
    });

    it('retryFailedJobs retries every failed job and reports the count', async () => {
      const jobs = [
        { retry: jest.fn().mockResolvedValue(undefined) },
        { retry: jest.fn().mockResolvedValue(undefined) },
      ];
      (getSubmissionQueue as jest.Mock).mockReturnValue({
        getFailed: jest.fn().mockResolvedValue(jobs),
      });

      const result = await service.retryFailedJobs();
      expect(result.retried).toBe(2);
      expect(jobs[0].retry).toHaveBeenCalled();
      expect(jobs[1].retry).toHaveBeenCalled();
    });

    it('retryFailedJobs reports 0 retried plus an error message on failure', async () => {
      (getSubmissionQueue as jest.Mock).mockImplementation(() => {
        throw new Error('boom');
      });

      const result = await service.retryFailedJobs();
      expect(result).toEqual({ retried: 0, error: 'boom' });
    });

    it('getBulkQueueStatus returns job counts from the bulk queue', async () => {
      (getBulkSubmissionQueue as jest.Mock).mockReturnValue({
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        }),
      });

      const result = await service.getBulkQueueStatus();
      expect(result).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });

    it('getBulkQueueStatus returns zeroed counts plus an error message if the queue throws', async () => {
      (getBulkSubmissionQueue as jest.Mock).mockImplementation(() => {
        throw new Error('bulk redis down');
      });

      const result = await service.getBulkQueueStatus();
      expect(result.error).toBe('bulk redis down');
    });
  });

  describe('retention delegation', () => {
    it('getRetentionStats delegates to RetentionService', async () => {
      const result = await service.getRetentionStats();
      expect(retentionService.getRetentionStats).toHaveBeenCalled();
      expect(result).toEqual({ stats: true });
    });

    it('runRetention archives both invoices and activity events and reports combined counts', async () => {
      const result = await service.runRetention();
      expect(result.invoicesArchived).toBe(3);
      expect(result.activityEventsArchived).toBe(5);
    });
  });

  it('exportPlatformCSV delegates to ExportService with the given date range', async () => {
    const result = await service.exportPlatformCSV('2026-01-01', '2026-01-31');
    expect(exportService.exportPlatformCSV).toHaveBeenCalledWith(
      '2026-01-01',
      '2026-01-31',
    );
    expect(result).toBe('csv-content');
  });

  describe('verifyAuditChain', () => {
    it('reports valid=true with brokenAt=null for an empty chain', async () => {
      tx.activityEvent.findMany.mockResolvedValue([]);
      const result = await service.verifyAuditChain();
      expect(result).toEqual({ valid: true, totalEvents: 0, brokenAt: null });
    });

    it('skips events without an entryHash (legacy rows)', async () => {
      tx.activityEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          tenantId: 't1',
          eventType: 'login',
          actor: 'user:u1',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          payload: {},
          entryHash: null,
          previousHash: null,
        },
      ]);
      const result = await service.verifyAuditChain();
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(1);
    });

    it('recomputes the hash chain correctly for a valid GENESIS-rooted chain', async () => {
      const occurredAt = new Date('2026-01-01T00:00:00.000Z');
      const payload = { foo: 'bar' };
      const hashInput = `t1|login|user:u1|${occurredAt.toISOString()}|${JSON.stringify(payload)}|GENESIS`;
      const entryHash = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');

      tx.activityEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          tenantId: 't1',
          eventType: 'login',
          actor: 'user:u1',
          occurredAt,
          payload,
          entryHash,
          previousHash: null,
        },
      ]);

      const result = await service.verifyAuditChain();
      expect(result).toEqual({ valid: true, totalEvents: 1, brokenAt: null });
    });

    it('detects a broken chain and reports the id of the first tampered event', async () => {
      tx.activityEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          tenantId: 't1',
          eventType: 'login',
          actor: 'user:u1',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          payload: {},
          entryHash: 'tampered-hash-value',
          previousHash: null,
        },
      ]);

      const result = await service.verifyAuditChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe('evt-1');
    });
  });
});
