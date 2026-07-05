/// <reference types="jest" />

import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { TenantService } from './tenant.service';

const MASTER_KEY = Buffer.from('master-key');

function makeTenant(overrides: Record<string, any> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme Ltd',
    tin: 'TIN123',
    registeredAddress: {
      streetName: '1 Main St',
      cityName: 'Lagos',
      state: 'Lagos',
      countryCode: 'NG',
    },
    appAdapterKey: 'mock',
    environment: 'SANDBOX',
    rateLimitTier: 'STANDARD',
    batchEnabled: false,
    batchSize: 100,
    isActive: true,
    encryptedCredential: null,
    credentialIv: null,
    interswitchClientId: null,
    interswitchClientSecret: null,
    interswitchSecretIv: null,
    interswitchServiceId: null,
    interswitchBusinessId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TenantService', () => {
  let service: TenantService;
  let tenantRepository: {
    findByTin: jest.Mock;
    findById: jest.Mock;
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deactivate: jest.Mock;
  };
  let credentialService: {
    encryptCredential: jest.Mock;
    encrypt: jest.Mock;
    decryptCredential: jest.Mock;
  };
  let secrets: { getMasterEncryptionKey: jest.Mock };
  let reminderService: { createDefaultRules: jest.Mock };

  beforeEach(() => {
    tenantRepository = {
      findByTin: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(makeTenant()),
      findAll: jest.fn().mockResolvedValue({ data: [makeTenant()], total: 1 }),
      create: jest.fn().mockResolvedValue(makeTenant()),
      update: jest.fn().mockResolvedValue(makeTenant()),
      deactivate: jest.fn().mockResolvedValue(makeTenant({ isActive: false })),
    };
    credentialService = {
      encryptCredential: jest.fn().mockReturnValue({
        encrypted: Buffer.from('enc'),
        iv: Buffer.from('iv'),
      }),
      encrypt: jest.fn().mockReturnValue({
        encrypted: Buffer.from('enc-secret'),
        iv: Buffer.from('iv-secret'),
      }),
      decryptCredential: jest.fn().mockReturnValue({ apiKey: 'decrypted' }),
    };
    secrets = {
      getMasterEncryptionKey: jest.fn().mockResolvedValue(MASTER_KEY),
    };
    reminderService = {
      createDefaultRules: jest.fn().mockResolvedValue(undefined),
    };

    service = new TenantService(
      tenantRepository as any,
      credentialService as any,
      secrets as any,
      reminderService as any,
    );
  });

  describe('createTenant', () => {
    const baseRequest = {
      name: 'Acme Ltd',
      tin: 'TIN123',
      registeredAddress: {
        streetName: '1 Main St',
        cityName: 'Lagos',
        state: 'Lagos',
        countryCode: 'NG',
      },
      appAdapterKey: 'mock',
    };

    it('throws ConflictException when a tenant with the same TIN already exists', async () => {
      tenantRepository.findByTin.mockResolvedValue(makeTenant());

      await expect(service.createTenant(baseRequest as any)).rejects.toThrow(
        ConflictException,
      );
      expect(tenantRepository.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the TIN format is invalid', async () => {
      await expect(
        service.createTenant({ ...baseRequest, tin: '$$' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tenantRepository.create).not.toHaveBeenCalled();
    });

    it('creates a tenant without touching credentials when none are provided', async () => {
      await service.createTenant(baseRequest);

      expect(secrets.getMasterEncryptionKey).not.toHaveBeenCalled();
      expect(tenantRepository.create).toHaveBeenCalledWith(
        baseRequest,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('encrypts appCredential using the tenant TIN as the key-derivation input', async () => {
      const request = {
        ...baseRequest,
        appCredential: { type: 'api_key', apiKey: 'plain-key' },
      };

      await service.createTenant(request as any);

      expect(credentialService.encryptCredential).toHaveBeenCalledWith(
        request.appCredential,
        MASTER_KEY,
        'TIN123',
      );
      expect(tenantRepository.create).toHaveBeenCalledWith(
        request,
        Buffer.from('enc'),
        Buffer.from('iv'),
        undefined,
        undefined,
      );
    });

    it('encrypts interswitch clientSecret separately from appCredential', async () => {
      const request = {
        ...baseRequest,
        interswitchCredentials: {
          clientId: 'client-1',
          clientSecret: 'plain-secret',
          serviceId: 'service-1',
          businessId: 'business-1',
        },
      };

      await service.createTenant(request);

      expect(credentialService.encrypt).toHaveBeenCalledWith(
        'plain-secret',
        MASTER_KEY,
        'TIN123',
      );
      expect(tenantRepository.create).toHaveBeenCalledWith(
        request,
        undefined,
        undefined,
        Buffer.from('enc-secret'),
        Buffer.from('iv-secret'),
      );
    });

    it('fires-and-forgets default reminder rule creation and does not fail the request if it rejects', async () => {
      reminderService.createDefaultRules.mockRejectedValue(new Error('boom'));

      await expect(
        service.createTenant(baseRequest as any),
      ).resolves.toBeDefined();
      expect(reminderService.createDefaultRules).toHaveBeenCalledWith(
        'tenant-1',
      );
    });
  });

  describe('getTenant', () => {
    it('returns the mapped tenant when found', async () => {
      const result = await service.getTenant('tenant-1');
      expect(result.id).toBe('tenant-1');
      expect(result.hasCredential).toBe(false);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      tenantRepository.findById.mockResolvedValue(null);
      await expect(service.getTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reports hasCredential/hasInterswitchCredentials as true when the encrypted pair is present', async () => {
      tenantRepository.findById.mockResolvedValue(
        makeTenant({
          encryptedCredential: Buffer.from('x'),
          credentialIv: Buffer.from('y'),
          interswitchClientId: 'client-1',
          interswitchClientSecret: Buffer.from('z'),
        }),
      );

      const result = await service.getTenant('tenant-1');
      expect(result.hasCredential).toBe(true);
      expect(result.hasInterswitchCredentials).toBe(true);
    });
  });

  describe('getTenantByTin', () => {
    it('returns the mapped tenant when found by TIN', async () => {
      tenantRepository.findByTin.mockResolvedValue(makeTenant());
      const result = await service.getTenantByTin('TIN123');
      expect(result.tin).toBe('TIN123');
    });

    it('throws NotFoundException when no tenant matches the TIN', async () => {
      tenantRepository.findByTin.mockResolvedValue(null);
      await expect(service.getTenantByTin('MISSING')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listTenants', () => {
    it('computes skip from page/limit and returns mapped data with total', async () => {
      await service.listTenants(3, 10);
      expect(tenantRepository.findAll).toHaveBeenCalledWith(20, 10);
    });

    it('defaults to page 1 / limit 20', async () => {
      await service.listTenants();
      expect(tenantRepository.findAll).toHaveBeenCalledWith(0, 20);
    });
  });

  describe('updateTenant', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      tenantRepository.findById.mockResolvedValue(null);
      await expect(
        service.updateTenant('missing', { name: 'New Name' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('re-encrypts appCredential using the existing tenant TIN, not client input', async () => {
      await service.updateTenant('tenant-1', {
        appCredential: { type: 'api_key', apiKey: 'new-key' },
      } as any);

      expect(credentialService.encryptCredential).toHaveBeenCalledWith(
        { type: 'api_key', apiKey: 'new-key' },
        MASTER_KEY,
        'TIN123',
      );
    });

    it('updates without touching credentials when none are provided', async () => {
      await service.updateTenant('tenant-1', { name: 'New Name' });

      expect(secrets.getMasterEncryptionKey).not.toHaveBeenCalled();
      expect(tenantRepository.update).toHaveBeenCalledWith(
        'tenant-1',
        { name: 'New Name' },
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('deactivateTenant', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      tenantRepository.findById.mockResolvedValue(null);
      await expect(service.deactivateTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates and returns the mapped tenant', async () => {
      const result = await service.deactivateTenant('tenant-1');
      expect(tenantRepository.deactivate).toHaveBeenCalledWith('tenant-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('getDecryptedCredential', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      tenantRepository.findById.mockResolvedValue(null);
      await expect(service.getDecryptedCredential('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns null when the tenant has no stored credential', async () => {
      tenantRepository.findById.mockResolvedValue(makeTenant());
      const result = await service.getDecryptedCredential('tenant-1');
      expect(result).toBeNull();
      expect(secrets.getMasterEncryptionKey).not.toHaveBeenCalled();
    });

    it('decrypts and returns the credential using the tenant TIN', async () => {
      tenantRepository.findById.mockResolvedValue(
        makeTenant({
          encryptedCredential: Buffer.from('enc'),
          credentialIv: Buffer.from('iv'),
        }),
      );

      const result = await service.getDecryptedCredential('tenant-1');

      expect(credentialService.decryptCredential).toHaveBeenCalledWith(
        Buffer.from('enc'),
        Buffer.from('iv'),
        MASTER_KEY,
        'TIN123',
      );
      expect(result).toEqual({ apiKey: 'decrypted' });
    });
  });
});
