/// <reference types="jest" />

import { NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConsentService } from './consent.service';

function makePrisma(tx: Record<string, any>) {
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('ConsentService', () => {
  let tx: Record<string, any>;
  let prisma: ReturnType<typeof makePrisma>;
  let service: ConsentService;

  beforeEach(() => {
    tx = {
      consentRecord: {
        create: jest.fn().mockResolvedValue({ id: 'consent-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasureRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'erasure-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma = makePrisma(tx);
    service = new ConsentService(prisma as any);
  });

  describe('record', () => {
    it('defaults consentVersion to 1.0 and nulls optional fields when omitted', async () => {
      await service.record({
        email: 'u@x.com',
        consentType: 'TERMS_AND_PRIVACY',
      });

      expect(tx.consentRecord.create).toHaveBeenCalledWith({
        data: {
          email: 'u@x.com',
          userId: null,
          tenantId: null,
          consentType: 'TERMS_AND_PRIVACY',
          consentVersion: '1.0',
          ipAddress: null,
          userAgent: null,
          metadata: Prisma.JsonNull,
        },
      });
    });

    it('persists provided userId/tenantId/version/ip/userAgent/metadata', async () => {
      await service.record({
        email: 'u@x.com',
        userId: 'user-1',
        tenantId: 'tenant-1',
        consentType: 'NDPR_DATA_PROCESSING',
        consentVersion: '2.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla',
        metadata: { source: 'signup' },
      });

      expect(tx.consentRecord.create).toHaveBeenCalledWith({
        data: {
          email: 'u@x.com',
          userId: 'user-1',
          tenantId: 'tenant-1',
          consentType: 'NDPR_DATA_PROCESSING',
          consentVersion: '2.0',
          ipAddress: '10.0.0.1',
          userAgent: 'Mozilla',
          metadata: { source: 'signup' },
        },
      });
    });
  });

  it('listByUser filters by userId ordered by most-recent consent', async () => {
    await service.listByUser('user-1');
    expect(tx.consentRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { consentedAt: 'desc' },
    });
  });

  describe('listAll', () => {
    it('applies no filters when none are provided', async () => {
      await service.listAll({});
      expect(tx.consentRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('applies only the filters that were provided', async () => {
      await service.listAll({ tenantId: 't1', email: 'u@x.com' });
      expect(tx.consentRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', email: 'u@x.com' },
        }),
      );
    });
  });

  describe('requestErasure', () => {
    it('throws ConflictException when a pending erasure request already exists', async () => {
      tx.erasureRequest.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.requestErasure({
          userId: 'user-1',
          tenantId: 'tenant-1',
          email: 'u@x.com',
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx.erasureRequest.create).not.toHaveBeenCalled();
    });

    it('creates the erasure request and flags erasureRequestedAt on the user', async () => {
      const result = await service.requestErasure({
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'u@x.com',
      });

      expect(tx.erasureRequest.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          email: 'u@x.com',
          status: 'PENDING',
        },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { erasureRequestedAt: expect.any(Date) },
      });
      expect(result.requestId).toBe('erasure-1');
    });
  });

  describe('listErasureRequests', () => {
    it('filters by status when provided', async () => {
      await service.listErasureRequests('PENDING');
      expect(tx.erasureRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    it('does not filter when status is omitted', async () => {
      await service.listErasureRequests();
      expect(tx.erasureRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('approveErasure', () => {
    it('throws NotFoundException when the erasure request does not exist', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.approveErasure('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the request is not PENDING', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue({
        id: 'erasure-1',
        status: 'APPROVED',
      });
      await expect(
        service.approveErasure('erasure-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('anonymises the user, revokes tokens/consents, and marks the request approved', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue({
        id: 'erasure-1',
        userId: 'user-1',
        email: 'u@x.com',
        status: 'PENDING',
      });

      const result = await service.approveErasure(
        'erasure-1',
        'admin-1',
        'confirmed identity',
      );

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          firstName: 'Erased',
          lastName: 'User',
          email: 'erased-user-1@deleted.billinx.ng',
          isActive: false,
          isErased: true,
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: Prisma.JsonNull,
        }),
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRevoked: false },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      });
      expect(tx.consentRecord.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRevoked: false },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      });
      expect(tx.erasureRequest.update).toHaveBeenCalledWith({
        where: { id: 'erasure-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedBy: 'admin-1',
          reviewNote: 'confirmed identity',
        }),
      });
      expect(result.message).toContain('u@x.com');
    });

    it('generates a fresh random password hash on every approval (no reused/static hash)', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue({
        id: 'erasure-1',
        userId: 'user-1',
        email: 'u@x.com',
        status: 'PENDING',
      });

      await service.approveErasure('erasure-1', 'admin-1');
      const firstHash = tx.user.update.mock.calls[0][0].data.passwordHash;

      tx.user.update.mockClear();
      await service.approveErasure('erasure-1', 'admin-1');
      const secondHash = tx.user.update.mock.calls[0][0].data.passwordHash;

      expect(firstHash).not.toBe(secondHash);
    });
  });

  describe('rejectErasure', () => {
    it('throws NotFoundException when the erasure request does not exist', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue(null);
      await expect(service.rejectErasure('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the request is not PENDING', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue({
        id: 'erasure-1',
        status: 'REJECTED',
      });
      await expect(
        service.rejectErasure('erasure-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('marks the request rejected and clears the pending flag on the user', async () => {
      tx.erasureRequest.findUnique.mockResolvedValue({
        id: 'erasure-1',
        userId: 'user-1',
        email: 'u@x.com',
        status: 'PENDING',
      });

      const result = await service.rejectErasure(
        'erasure-1',
        'admin-1',
        'insufficient proof',
      );

      expect(tx.erasureRequest.update).toHaveBeenCalledWith({
        where: { id: 'erasure-1' },
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedBy: 'admin-1',
          reviewNote: 'insufficient proof',
        }),
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { erasureRequestedAt: null },
      });
      expect(result.message).toContain('u@x.com');
    });
  });
});
