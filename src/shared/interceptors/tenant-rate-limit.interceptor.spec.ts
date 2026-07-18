/// <reference types="jest" />

import { HttpException } from '@nestjs/common';
import { of } from 'rxjs';
import { TenantRateLimitInterceptor } from './tenant-rate-limit.interceptor';

function makeContext(billinxContext: any) {
  const res = { setHeader: jest.fn() };
  const req = { _billinxContext: billinxContext };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as any;
  return { context, res };
}

describe('TenantRateLimitInterceptor', () => {
  let redisService: { checkRateLimit: jest.Mock };
  let interceptor: TenantRateLimitInterceptor;
  const next = { handle: () => of('ok') };

  beforeEach(() => {
    redisService = { checkRateLimit: jest.fn() };
    interceptor = new TenantRateLimitInterceptor(redisService as any);
  });

  it('passes through untouched when there is no request context', async () => {
    const { context } = makeContext(undefined);
    await interceptor.intercept(context, next);
    expect(redisService.checkRateLimit).not.toHaveBeenCalled();
  });

  it('buckets JWT dashboard users per tenant, not per key', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 599,
      retryAfter: 0,
    });
    const { context } = makeContext({
      tenantId: 'tenant-1',
      actorType: 'user',
      actor: 'user:u1',
      tier: 'STANDARD',
    });

    await interceptor.intercept(context, next);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^rl:dashboard:tenant:tenant-1:\d+$/),
      600,
      3600,
    );
  });

  it('buckets an API key request per keyId, not per tenant', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 299,
      retryAfter: 0,
    });
    const { context } = makeContext({
      tenantId: 'tenant-1',
      actorType: 'apikey',
      actor: 'apikey:key-abc',
      tier: 'STANDARD',
    });

    await interceptor.intercept(context, next);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^rl:api:key:key-abc:\d+$/),
      300,
      3600,
    );
  });

  it('gives two different API keys under the same tenant independent buckets', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 0,
      retryAfter: 0,
    });

    const { context: ctxA } = makeContext({
      tenantId: 'tenant-1',
      actorType: 'apikey',
      actor: 'apikey:key-a',
      tier: 'PREMIUM',
    });
    const { context: ctxB } = makeContext({
      tenantId: 'tenant-1',
      actorType: 'apikey',
      actor: 'apikey:key-b',
      tier: 'PREMIUM',
    });

    await interceptor.intercept(ctxA, next);
    await interceptor.intercept(ctxB, next);

    const keysUsed = redisService.checkRateLimit.mock.calls.map((c) => c[0]);
    expect(keysUsed[0]).toContain('key-a');
    expect(keysUsed[1]).toContain('key-b');
    expect(keysUsed[0]).not.toEqual(keysUsed[1]);
    // Each key still gets the tenant's tier limit as its own ceiling.
    expect(redisService.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      1000,
      3600,
    );
    expect(redisService.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      1000,
      3600,
    );
  });

  it('throws 429 with Retry-After when an API key exceeds its own bucket', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 120,
    });
    const { context, res } = makeContext({
      tenantId: 'tenant-1',
      actorType: 'apikey',
      actor: 'apikey:key-abc',
      tier: 'STANDARD',
    });

    await expect(interceptor.intercept(context, next)).rejects.toThrow(
      HttpException,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 120);
  });
});
