/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

function makeContext(
  headers: Record<string, string> = {},
  ip = '127.0.0.1',
): { context: ExecutionContext; req: any } {
  const req: any = { headers, ip };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('ApiKeyGuard', () => {
  let apiKeyService: { verifyApiKey: jest.Mock };
  let prisma: { asAdmin: jest.Mock };
  let guard: ApiKeyGuard;

  beforeEach(() => {
    apiKeyService = { verifyApiKey: jest.fn() };
    prisma = {
      asAdmin: jest.fn().mockResolvedValue({
        rateLimitTier: 'STANDARD',
        environment: 'PRODUCTION',
      }),
    };
    guard = new ApiKeyGuard(apiKeyService as any, prisma as any);
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing or malformed Authorization header. Expected: Bearer <api_key>',
    );
  });

  it('throws UnauthorizedException when the key does not match the blx_live_/blx_test_ format', async () => {
    const { context } = makeContext({
      authorization: 'Bearer not-a-valid-key',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid API key format',
    );
    expect(apiKeyService.verifyApiKey).not.toHaveBeenCalled();
  });

  it('propagates the error when verifyApiKey rejects', async () => {
    apiKeyService.verifyApiKey.mockRejectedValue(
      new UnauthorizedException('Invalid or expired API key'),
    );
    const { context } = makeContext({
      authorization: 'Bearer blx_live_abcdefghijklmnopqrstuvwx',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired API key',
    );
  });

  it('throws UnauthorizedException when the tenant cannot be found', async () => {
    apiKeyService.verifyApiKey.mockResolvedValue({
      tenantId: 'tenant-001',
      keyId: 'key-1',
      environment: 'PRODUCTION',
    });
    prisma.asAdmin.mockResolvedValue(null);
    const { context } = makeContext({
      authorization: 'Bearer blx_live_abcdefghijklmnopqrstuvwx',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Tenant not found',
    );
  });

  it('populates request context with actorType "apikey" on success', async () => {
    apiKeyService.verifyApiKey.mockResolvedValue({
      tenantId: 'tenant-001',
      keyId: 'key-1',
      environment: 'PRODUCTION',
    });
    const { context, req } = makeContext({
      authorization: 'Bearer blx_live_abcdefghijklmnopqrstuvwx',
      'x-forwarded-for': '203.0.113.5, 10.0.0.1',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req._billinxContext).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-001',
        actor: 'apikey:key-1',
        actorType: 'apikey',
        tier: 'STANDARD',
        isAdmin: false,
      }),
    );
    expect(apiKeyService.verifyApiKey).toHaveBeenCalledWith(
      'blx_live_abcdefghijklmnopqrstuvwx',
      '203.0.113.5',
    );
  });
});
