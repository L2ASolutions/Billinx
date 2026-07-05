/// <reference types="jest" />

import { NotFoundException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ClientService } from './client.service';

const TENANT_ID = 'tenant-001';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

function makeClientRow(overrides: Record<string, any> = {}) {
  return {
    id: 'client-1',
    tenantId: TENANT_ID,
    companyName: 'Acme Ltd',
    tin: 'TIN123',
    email: 'acme@x.com',
    telephone: '+2340000000',
    businessDescription: 'Widgets',
    contactPerson: 'Jane Doe',
    notes: 'VIP',
    postalAddress: { city: 'Lagos' },
    totalInvoices: 5,
    totalBilled: new Decimal(1000),
    lastInvoiceAt: new Date('2026-01-10T00:00:00.000Z'),
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ClientService', () => {
  let prisma: { client: Record<string, jest.Mock> };
  let activityService: { track: jest.Mock };
  let service: ClientService;

  beforeEach(() => {
    prisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(makeClientRow()),
        findMany: jest.fn().mockResolvedValue([makeClientRow()]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(makeClientRow()),
        update: jest.fn().mockResolvedValue(makeClientRow()),
      },
    };
    activityService = { track: jest.fn() };
    service = new ClientService(prisma as any, activityService as any);
  });

  describe('create', () => {
    it('creates a new client and tracks a CLIENT_CREATED activity event', async () => {
      const result = await service.create(TENANT_ID, {
        companyName: 'Acme Ltd',
        tin: 'TIN123',
      });

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          companyName: 'Acme Ltd',
          tin: 'TIN123',
        }),
      });
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CLIENT_CREATED',
          entityId: 'client-1',
        }),
      );
      expect(result.id).toBe('client-1');
    });

    it('throws ConflictException when an active client with the same TIN already exists', async () => {
      prisma.client.findUnique.mockResolvedValue(
        makeClientRow({ isActive: true }),
      );

      await expect(
        service.create(TENANT_ID, { companyName: 'Acme Ltd', tin: 'TIN123' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('reactivates a soft-deleted client instead of creating a duplicate', async () => {
      prisma.client.findUnique.mockResolvedValue(
        makeClientRow({ isActive: false, companyName: 'Old Name' }),
      );
      prisma.client.update.mockResolvedValue(
        makeClientRow({ isActive: true, companyName: 'New Name' }),
      );

      const result = await service.create(TENANT_ID, {
        companyName: 'New Name',
        tin: 'TIN123',
      });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: expect.objectContaining({
          isActive: true,
          companyName: 'New Name',
        }),
      });
      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(result.companyName).toBe('New Name');
    });

    it('does not check for TIN conflicts when no TIN is provided', async () => {
      await service.create(TENANT_ID, { companyName: 'No TIN Co' });
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('scopes to tenantId and isActive=true', async () => {
      await service.findAll(TENANT_ID);
      expect(prisma.client.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, isActive: true },
      });
    });

    it('applies a company-name/TIN search filter when given', async () => {
      await service.findAll(TENANT_ID, 'acme');
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_ID,
            isActive: true,
            OR: [
              { companyName: { contains: 'acme', mode: 'insensitive' } },
              { tin: { contains: 'acme', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('paginates using page/limit and orders by totalInvoices descending', async () => {
      await service.findAll(TENANT_ID, undefined, 3, 10);
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { totalInvoices: 'desc' },
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when no client matches id+tenantId', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.findOne(TENANT_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the lookup to both id and tenantId (tenant isolation)', async () => {
      await service.findOne(TENANT_ID, 'client-1');
      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { id: 'client-1', tenantId: TENANT_ID },
      });
    });

    it('converts totalBilled Decimal to a number', async () => {
      const result = await service.findOne(TENANT_ID, 'client-1');
      expect(result.totalBilled).toBe(1000);
      expect(typeof result.totalBilled).toBe('number');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the client does not exist for this tenant', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.update(TENANT_ID, 'missing', { companyName: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when changing TIN collides with a different client', async () => {
      prisma.client.findUnique.mockResolvedValue(
        makeClientRow({ id: 'other-client', tin: 'TIN999' }),
      );

      await expect(
        service.update(TENANT_ID, 'client-1', { tin: 'TIN999' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows updating other fields when the TIN is unchanged', async () => {
      await service.update(TENANT_ID, 'client-1', {
        tin: 'TIN123',
        companyName: 'Renamed',
      });
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.update).toHaveBeenCalled();
    });

    it('falls back to existing values for fields not present in the patch', async () => {
      await service.update(TENANT_ID, 'client-1', { companyName: 'Renamed' });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: expect.objectContaining({
          companyName: 'Renamed',
          email: 'acme@x.com',
          telephone: '+2340000000',
        }),
      });
    });

    it('overwrites falsy-but-defined fields (empty string, isActive=false) rather than falling back', async () => {
      await service.update(TENANT_ID, 'client-1', {
        email: '',
        isActive: false,
      });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: expect.objectContaining({ email: '', isActive: false }),
      });
    });

    it('tracks a CLIENT_UPDATED activity event', async () => {
      await service.update(TENANT_ID, 'client-1', { companyName: 'Renamed' });
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CLIENT_UPDATED',
          entityId: 'client-1',
        }),
      );
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the client does not exist for this tenant', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.delete(TENANT_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes by setting isActive=false', async () => {
      const result = await service.delete(TENANT_ID, 'client-1');
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { isActive: false },
      });
      expect(result).toEqual({ deleted: true, id: 'client-1' });
    });
  });

  describe('getFrequent', () => {
    it('orders by totalInvoices descending and applies the limit', async () => {
      await service.getFrequent(TENANT_ID, 3);
      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, isActive: true },
        orderBy: { totalInvoices: 'desc' },
        take: 3,
      });
    });

    it('defaults to a limit of 5', async () => {
      await service.getFrequent(TENANT_ID);
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('syncFromInvoice', () => {
    it('does nothing when the invoice has no buyer name', async () => {
      await service.syncFromInvoice(TENANT_ID, { totalAmount: 100 });
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('increments totalInvoices/totalBilled and sets lastInvoiceAt for an existing client matched by TIN', async () => {
      prisma.client.findUnique.mockResolvedValue(makeClientRow());

      await service.syncFromInvoice(TENANT_ID, {
        buyerTin: 'TIN123',
        buyerName: 'Acme Ltd',
        totalAmount: 250,
      });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: {
          totalInvoices: { increment: 1 },
          totalBilled: { increment: new Decimal(250) },
          lastInvoiceAt: expect.any(Date),
        },
      });
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('auto-creates a new client from buyer details when no existing TIN match is found', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await service.syncFromInvoice(TENANT_ID, {
        buyerTin: 'TIN999',
        buyerName: 'New Buyer Ltd',
        totalAmount: 500,
        buyerParty: { email: 'buyer@x.com', postalAddress: { city: 'Abuja' } },
      });

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          companyName: 'New Buyer Ltd',
          tin: 'TIN999',
          email: 'buyer@x.com',
          postalAddress: { city: 'Abuja' },
          totalInvoices: 1,
          totalBilled: new Decimal(500),
        }),
      });
    });

    it('reads buyer name/tin from buyerParty when the flat fields are absent', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await service.syncFromInvoice(TENANT_ID, {
        buyerParty: { partyName: 'Fallback Ltd', tin: 'TIN777' },
        totalAmount: 100,
      });

      expect(prisma.client.findUnique).toHaveBeenCalledWith({
        where: { tenantId_tin: { tenantId: TENANT_ID, tin: 'TIN777' } },
      });
      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyName: 'Fallback Ltd',
          tin: 'TIN777',
        }),
      });
    });

    it('silently swallows unique-constraint errors from concurrent auto-create attempts', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      prisma.client.create.mockRejectedValue(
        new Error('unique constraint violation'),
      );

      await expect(
        service.syncFromInvoice(TENANT_ID, {
          buyerTin: 'TIN999',
          buyerName: 'Racy Ltd',
          totalAmount: 100,
        }),
      ).resolves.toBeUndefined();
    });

    it('auto-creates without a TIN lookup when the invoice has no buyerTin', async () => {
      await service.syncFromInvoice(TENANT_ID, {
        buyerName: 'Walk-in Buyer',
        totalAmount: 100,
      });

      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyName: 'Walk-in Buyer',
          tin: null,
        }),
      });
    });
  });
});
