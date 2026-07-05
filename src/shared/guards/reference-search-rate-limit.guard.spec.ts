/// <reference types="jest" />

import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ReferenceSearchRateLimitGuard } from './reference-search-rate-limit.guard';

function makeContext(reqOverrides: Record<string, any> = {}): {
  context: ExecutionContext;
  res: { setHeader: jest.Mock };
} {
  const res = { setHeader: jest.fn() };
  const req = {
    headers: {},
    socket: { remoteAddress: '10.0.0.1' },
    ip: '10.0.0.1',
    ...reqOverrides,
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, res };
}

describe('ReferenceSearchRateLimitGuard', () => {
  let redisService: { checkRateLimit: jest.Mock };
  let guard: ReferenceSearchRateLimitGuard;

  beforeEach(() => {
    redisService = { checkRateLimit: jest.fn() };
    guard = new ReferenceSearchRateLimitGuard(redisService as any);
  });

  it('allows the request and sets rate-limit headers when under the limit', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 55,
      retryAfter: 0,
    });
    const { context, res } = makeContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 55);
    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:refsearch:ip:10.0.0.1',
      60,
      300,
    );
  });

  it('throws a 429 HttpException with Retry-After when over the limit', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 90,
    });
    const { context, res } = makeContext();

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 90);

    try {
      await guard.canActivate(context);
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.getResponse()).toEqual(
        expect.objectContaining({
          statusCode: 429,
          error: 'TOO_MANY_REQUESTS',
          retryAfter: 90,
        }),
      );
    }
  });

  it('keys the rate limit per-IP using the first x-forwarded-for entry', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:refsearch:ip:203.0.113.5',
      60,
      300,
    );
  });

  it('falls back to socket.remoteAddress when there is no x-forwarded-for header', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: {},
      socket: { remoteAddress: '198.51.100.9' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:refsearch:ip:198.51.100.9',
      60,
      300,
    );
  });

  it('strips the IPv6-mapped IPv4 prefix from the resolved IP', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: { 'x-forwarded-for': '::ffff:203.0.113.5' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:refsearch:ip:203.0.113.5',
      60,
      300,
    );
  });
});
