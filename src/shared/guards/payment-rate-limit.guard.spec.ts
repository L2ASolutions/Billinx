/// <reference types="jest" />

import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { PaymentRateLimitGuard } from './payment-rate-limit.guard';

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

describe('PaymentRateLimitGuard', () => {
  let redisService: { checkRateLimit: jest.Mock };
  let guard: PaymentRateLimitGuard;

  beforeEach(() => {
    redisService = { checkRateLimit: jest.fn() };
    guard = new PaymentRateLimitGuard(redisService as any);
  });

  it('allows the request and sets rate-limit headers when under the limit', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 7,
      retryAfter: 0,
    });
    const { context, res } = makeContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 7);
    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:payment:ip:10.0.0.1',
      10,
      300,
    );
  });

  it('throws a 429 HttpException with Retry-After when over the limit', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 120,
    });
    const { context, res } = makeContext();

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 120);

    try {
      await guard.canActivate(context);
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.getResponse()).toEqual(
        expect.objectContaining({
          statusCode: 429,
          error: 'TOO_MANY_REQUESTS',
        }),
      );
    }
  });

  it('keys the rate limit per-IP using the first x-forwarded-for entry', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:payment:ip:203.0.113.5',
      10,
      300,
    );
  });

  it('falls back to socket.remoteAddress when there is no x-forwarded-for header', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: {},
      socket: { remoteAddress: '198.51.100.9' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:payment:ip:198.51.100.9',
      10,
      300,
    );
  });

  it('strips the IPv6-mapped IPv4 prefix from the resolved IP', async () => {
    redisService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfter: 0,
    });
    const { context } = makeContext({
      headers: { 'x-forwarded-for': '::ffff:203.0.113.5' },
    });

    await guard.canActivate(context);

    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'rl:payment:ip:203.0.113.5',
      10,
      300,
    );
  });
});
