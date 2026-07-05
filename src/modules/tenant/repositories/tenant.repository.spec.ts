/// <reference types="jest" />

import { TenantRepository } from './tenant.repository';

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('TenantRepository', () => {
  let repository: TenantRepository;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    repository = new TenantRepository(prisma as any);
  });

  it('findById looks up the tenant by id via asAdmin (bypassing RLS)', async () => {
    prisma.__tx.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

    const result = await repository.findById('tenant-1');

    expect(prisma.asAdmin).toHaveBeenCalled();
    expect(prisma.__tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
    expect(result).toEqual({ id: 'tenant-1' });
  });

  it('findByTin looks up the tenant by tin', async () => {
    prisma.__tx.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      tin: 'TIN123',
    });

    const result = await repository.findByTin('TIN123');

    expect(prisma.__tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { tin: 'TIN123' },
    });
    expect(result).toEqual({ id: 'tenant-1', tin: 'TIN123' });
  });

  describe('findAll', () => {
    it('paginates using skip/take and returns data with total count', async () => {
      prisma.__tx.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
      prisma.__tx.tenant.count.mockResolvedValue(1);

      const result = await repository.findAll(10, 5);

      expect(prisma.__tx.tenant.findMany).toHaveBeenCalledWith({
        skip: 10,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: [{ id: 'tenant-1' }], total: 1 });
    });

    it('defaults to skip 0 / take 20 when not provided', async () => {
      await repository.findAll();

      expect(prisma.__tx.tenant.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('applies defaults for environment, rateLimitTier, batchEnabled, and batchSize when omitted', async () => {
      await repository.create({
        name: 'Acme Ltd',
        tin: 'TIN123',
        registeredAddress: {
          streetName: '1 Main St',
          cityName: 'Lagos',
          state: 'Lagos',
          countryCode: 'NG',
        },
        appAdapterKey: 'mock',
      });

      expect(prisma.__tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          environment: 'SANDBOX',
          rateLimitTier: 'STANDARD',
          batchEnabled: false,
          batchSize: 100,
          encryptedCredential: null,
          credentialIv: null,
          interswitchClientId: null,
          interswitchClientSecret: null,
          interswitchSecretIv: null,
          interswitchServiceId: null,
          interswitchBusinessId: null,
        }),
      });
    });

    it('persists encrypted credential buffers and interswitch fields when provided', async () => {
      const encryptedCredential = Buffer.from('cred');
      const credentialIv = Buffer.from('iv1');
      const interswitchClientSecret = Buffer.from('secret');
      const interswitchSecretIv = Buffer.from('iv2');

      await repository.create(
        {
          name: 'Acme Ltd',
          tin: 'TIN123',
          registeredAddress: {
            streetName: '1 Main St',
            cityName: 'Lagos',
            state: 'Lagos',
            countryCode: 'NG',
          },
          appAdapterKey: 'interswitch',
          environment: 'PRODUCTION',
          rateLimitTier: 'PREMIUM',
          batchEnabled: true,
          batchSize: 250,
          interswitchCredentials: {
            clientId: 'client-1',
            clientSecret: 'plaintext-should-not-be-used',
            serviceId: 'service-1',
            businessId: 'business-1',
          },
        } as any,
        encryptedCredential,
        credentialIv,
        interswitchClientSecret,
        interswitchSecretIv,
      );

      expect(prisma.__tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          environment: 'PRODUCTION',
          rateLimitTier: 'PREMIUM',
          batchEnabled: true,
          batchSize: 250,
          encryptedCredential,
          credentialIv,
          interswitchClientId: 'client-1',
          interswitchClientSecret,
          interswitchSecretIv,
          interswitchServiceId: 'service-1',
          interswitchBusinessId: 'business-1',
        }),
      });
    });
  });

  describe('update', () => {
    it('only includes fields that were actually provided (partial update)', async () => {
      await repository.update('tenant-1', { name: 'New Name' });

      expect(prisma.__tx.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { name: 'New Name' },
      });
    });

    it('includes falsy-but-defined batchEnabled/batchSize/isActive values (undefined check, not truthy check)', async () => {
      await repository.update('tenant-1', {
        batchEnabled: false,
        batchSize: 0,
        isActive: false,
      });

      expect(prisma.__tx.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { batchEnabled: false, batchSize: 0, isActive: false },
      });
    });

    it('pairs encryptedCredential with credentialIv, and interswitchClientSecret with interswitchSecretIv', async () => {
      const encryptedCredential = Buffer.from('cred');
      const credentialIv = Buffer.from('iv1');
      const interswitchClientSecret = Buffer.from('secret');
      const interswitchSecretIv = Buffer.from('iv2');

      await repository.update(
        'tenant-1',
        {},
        encryptedCredential,
        credentialIv,
        interswitchClientSecret,
        interswitchSecretIv,
      );

      expect(prisma.__tx.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: {
          encryptedCredential,
          credentialIv,
          interswitchClientSecret,
          interswitchSecretIv,
        },
      });
    });
  });

  it('deactivate sets isActive to false', async () => {
    await repository.deactivate('tenant-1');

    expect(prisma.__tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { isActive: false },
    });
  });
});
