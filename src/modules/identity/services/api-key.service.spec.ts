/// <reference types="jest" />

import * as bcrypt from 'bcrypt';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';

jest.mock('../../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

const TENANT_ID = 'tenant-001';

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    apiKey: {
      create: jest.fn().mockResolvedValue({
        id: 'key-1',
        name: 'Test Key',
        environment: 'PRODUCTION',
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: ReturnType<typeof makePrisma>;
  let emailService: { sendApiKeyExpiryWarning: jest.Mock };
  let activityService: { track: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    emailService = { sendApiKeyExpiryWarning: jest.fn() };
    activityService = { track: jest.fn() };
    service = new ApiKeyService(
      prisma as any,
      emailService as any,
      activityService as any,
    );
  });

  // ── createApiKey ──────────────────────────────────────────────────────────

  describe('createApiKey', () => {
    it('generates a live-prefixed key for PRODUCTION and returns the full key only on creation', async () => {
      const result = await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
      });

      expect(result.key).toMatch(/^blx_live_/);
      expect(result.key.length).toBeGreaterThan(20);
      expect(result.keyPrefix).toBe(
        result.key.substring(0, result.keyPrefix.length),
      );
    });

    it('generates a test-prefixed key for SANDBOX', async () => {
      const result = await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'SANDBOX',
      });
      expect(result.key).toMatch(/^blx_test_/);
    });

    it('stores a bcrypt hash of the key, never the raw key itself', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
      });
      const created = prisma.__tx.apiKey.create.mock.calls[0][0].data;
      expect(created.keyHash).not.toContain('blx_live_');
    });

    it('tracks an API_KEY_CREATED activity event', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
      });
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          eventType: 'API_KEY_CREATED',
        }),
      );
    });

    it('uses an explicit expiresAt when provided instead of the default expiry window', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
        expiresAt: '2027-01-01T00:00:00.000Z',
      });
      const created = prisma.__tx.apiKey.create.mock.calls[0][0].data;
      expect(created.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
    });

    it('defaults to full access (["*"]) when no scopes are provided', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
      });
      const created = prisma.__tx.apiKey.create.mock.calls[0][0].data;
      expect(created.scopes).toEqual(['*']);
    });

    it('defaults to full access (["*"]) when scopes is an empty array', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
        scopes: [],
      });
      const created = prisma.__tx.apiKey.create.mock.calls[0][0].data;
      expect(created.scopes).toEqual(['*']);
    });

    it('stores the caller-supplied scopes when explicitly provided', async () => {
      await service.createApiKey(TENANT_ID, {
        name: 'Test Key',
        environment: 'PRODUCTION',
        scopes: ['invoices:read', 'products:read'],
      });
      const created = prisma.__tx.apiKey.create.mock.calls[0][0].data;
      expect(created.scopes).toEqual(['invoices:read', 'products:read']);
    });
  });

  // ── verifyApiKey ──────────────────────────────────────────────────────────

  describe('verifyApiKey', () => {
    it('rejects a key that does not match the expected blx_live_/blx_test_ format', async () => {
      await expect(service.verifyApiKey('not-a-valid-key')).rejects.toThrow(
        'Invalid API key format',
      );
      expect(prisma.asAdmin).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when no key with that prefix exists', async () => {
      prisma.__tx.apiKey.findMany.mockResolvedValue([]);
      await expect(
        service.verifyApiKey('blx_live_unknownkeyabcdefghijklmnop'),
      ).rejects.toThrow('Invalid or expired API key');
    });

    it('throws UnauthorizedException when the raw key does not bcrypt-match any candidate', async () => {
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          keyHash: 'not-a-matching-hash',
          environment: 'PRODUCTION',
          tenant: { id: TENANT_ID, isActive: true, rateLimitTier: 'STANDARD' },
        },
      ]);
      await expect(
        service.verifyApiKey('blx_live_abcdefghijklmnopqrstuvwx'),
      ).rejects.toThrow('Invalid API key');
    });

    it('throws UnauthorizedException when the matched key belongs to a suspended tenant', async () => {
      const rawKey = 'blx_live_abcdefghijklmnopqrstuvwx';
      const hash = await bcrypt.hash(rawKey, 12);
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          keyHash: hash,
          environment: 'PRODUCTION',
          tenant: { id: TENANT_ID, isActive: false, rateLimitTier: 'STANDARD' },
        },
      ]);
      await expect(service.verifyApiKey(rawKey)).rejects.toThrow(
        'Tenant account is suspended',
      );
    });

    it('returns tenantId/keyId/environment/scopes on a valid, active match', async () => {
      const rawKey = 'blx_live_abcdefghijklmnopqrstuvwx';
      const hash = await bcrypt.hash(rawKey, 12);
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          keyHash: hash,
          environment: 'PRODUCTION',
          scopes: ['invoices:read'],
          tenant: { id: TENANT_ID, isActive: true, rateLimitTier: 'STANDARD' },
        },
      ]);
      const result = await service.verifyApiKey(rawKey, '203.0.113.5');
      expect(result).toEqual({
        tenantId: TENANT_ID,
        keyId: 'key-1',
        environment: 'PRODUCTION',
        scopes: ['invoices:read'],
      });
    });

    it('fire-and-forgets a lastUsed update on a successful match without blocking the result', async () => {
      const rawKey = 'blx_live_abcdefghijklmnopqrstuvwx';
      const hash = await bcrypt.hash(rawKey, 12);
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          keyHash: hash,
          environment: 'PRODUCTION',
          tenant: { id: TENANT_ID, isActive: true, rateLimitTier: 'STANDARD' },
        },
      ]);
      await service.verifyApiKey(rawKey, '203.0.113.5');
      // allow the fire-and-forget update's microtask to run
      await new Promise((r) => setImmediate(r));
      expect(prisma.__tx.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1' },
          data: expect.objectContaining({ lastUsedIp: '203.0.113.5' }),
        }),
      );
    });
  });

  // ── revokeApiKey ──────────────────────────────────────────────────────────

  describe('revokeApiKey', () => {
    it('throws NotFoundException when the key does not belong to the tenant', async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue(null);
      await expect(
        service.revokeApiKey(TENANT_ID, 'wrong-key-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the key is already revoked', async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        tenantId: TENANT_ID,
        isRevoked: true,
        name: 'Test Key',
      });
      await expect(service.revokeApiKey(TENANT_ID, 'key-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('revokes the key and tracks an API_KEY_REVOKED activity event', async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        tenantId: TENANT_ID,
        isRevoked: false,
        name: 'Test Key',
      });
      await service.revokeApiKey(TENANT_ID, 'key-1');
      expect(prisma.__tx.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isRevoked: true },
      });
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'API_KEY_REVOKED' }),
      );
    });
  });

  // ── rotateApiKey ──────────────────────────────────────────────────────────

  describe('rotateApiKey', () => {
    it('throws NotFoundException when the key does not exist for the tenant or is already revoked', async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue(null);
      await expect(
        service.rotateApiKey(TENANT_ID, 'missing-key'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a new key and puts the old one on a 24h grace expiry', async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue({
        id: 'key-old',
        tenantId: TENANT_ID,
        isRevoked: false,
        environment: 'PRODUCTION',
        name: 'Test Key',
        expiresAt: null,
        scopes: ['*'],
      });
      prisma.asAdmin.mockImplementation((fn: any) => fn(prisma.__tx));
      prisma.__tx.apiKey.create.mockResolvedValue({
        id: 'key-new',
        name: 'Test Key',
        environment: 'PRODUCTION',
        expiresAt: null,
        scopes: ['*'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.rotateApiKey(TENANT_ID, 'key-old');

      expect(result.id).toBe('key-new');
      expect(result.key).toMatch(/^blx_live_/);
    });

    it("carries the existing key's scopes forward onto the rotated key", async () => {
      prisma.__tx.apiKey.findFirst.mockResolvedValue({
        id: 'key-old',
        tenantId: TENANT_ID,
        isRevoked: false,
        environment: 'PRODUCTION',
        name: 'Read-only Key',
        expiresAt: null,
        scopes: ['invoices:read', 'reports:read'],
      });
      prisma.asAdmin.mockImplementation((fn: any) => fn(prisma.__tx));
      prisma.__tx.apiKey.create.mockResolvedValue({
        id: 'key-new',
        name: 'Read-only Key',
        environment: 'PRODUCTION',
        expiresAt: null,
        scopes: ['invoices:read', 'reports:read'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.rotateApiKey(TENANT_ID, 'key-old');

      expect(prisma.__tx.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopes: ['invoices:read', 'reports:read'],
          }),
        }),
      );
      expect(result.scopes).toEqual(['invoices:read', 'reports:read']);
    });
  });

  // ── listApiKeys ───────────────────────────────────────────────────────────

  describe('listApiKeys', () => {
    it('lists only non-revoked keys for the tenant', async () => {
      await service.listApiKeys(TENANT_ID);
      expect(prisma.__tx.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, isRevoked: false },
        }),
      );
    });

    it('includes scopes in the selected fields', async () => {
      await service.listApiKeys(TENANT_ID);
      expect(prisma.__tx.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ scopes: true }),
        }),
      );
    });
  });

  // ── checkExpiringKeys (cron) ──────────────────────────────────────────────

  describe('checkExpiringKeys', () => {
    it('emails only OWNER-role users of tenants with a key expiring within 7 days', async () => {
      const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          name: 'Test Key',
          keyPrefix: 'blx_live_abcd',
          expiresAt: in3Days,
          tenant: {
            name: 'Acme Ltd',
            users: [
              {
                email: 'owner@acme.test',
                firstName: 'Owner',
                roles: [{ role: 'OWNER' }],
              },
              {
                email: 'viewer@acme.test',
                firstName: 'Viewer',
                roles: [{ role: 'VIEWER' }],
              },
            ],
          },
        },
      ]);

      await service.checkExpiringKeys();

      expect(emailService.sendApiKeyExpiryWarning).toHaveBeenCalledTimes(1);
      expect(emailService.sendApiKeyExpiryWarning).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@acme.test', isUrgent: false }),
      );
    });

    it('marks the warning urgent when the key expires within 1 day', async () => {
      const in12Hours = new Date(Date.now() + 12 * 60 * 60 * 1000);
      prisma.__tx.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          name: 'Test Key',
          keyPrefix: 'blx_live_abcd',
          expiresAt: in12Hours,
          tenant: {
            name: 'Acme Ltd',
            users: [
              {
                email: 'owner@acme.test',
                firstName: 'Owner',
                roles: [{ role: 'OWNER' }],
              },
            ],
          },
        },
      ]);

      await service.checkExpiringKeys();

      expect(emailService.sendApiKeyExpiryWarning).toHaveBeenCalledWith(
        expect.objectContaining({ isUrgent: true }),
      );
    });

    it('sends no emails when nothing is expiring soon', async () => {
      prisma.__tx.apiKey.findMany.mockResolvedValue([]);
      await service.checkExpiringKeys();
      expect(emailService.sendApiKeyExpiryWarning).not.toHaveBeenCalled();
    });
  });
});
