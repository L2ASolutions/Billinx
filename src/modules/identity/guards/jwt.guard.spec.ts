/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

function makeContext(headers: Record<string, string> = {}): {
  context: ExecutionContext;
  req: any;
} {
  const req: any = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtGuard', () => {
  let tokenService: { verifyAccessToken: jest.Mock };
  let guard: JwtGuard;

  beforeEach(() => {
    tokenService = { verifyAccessToken: jest.fn() };
    guard = new JwtGuard(tokenService as any);
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing Authorization header',
    );
  });

  it('throws UnauthorizedException when the Authorization header is not a Bearer token', async () => {
    const { context } = makeContext({ authorization: 'Basic abcdef' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('propagates the error when the token fails verification', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(
      new UnauthorizedException('Access token expired'),
    );
    const { context } = makeContext({ authorization: 'Bearer bad-token' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Access token expired',
    );
  });

  it('populates the request context and request._billinxContext for a valid token', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-001',
      tenantId: 'tenant-001',
      environment: 'PRODUCTION',
      tier: 'STANDARD',
      role: 'member',
    });
    const { context, req } = makeContext({
      authorization: 'Bearer good-token',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req._billinxContext).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-001',
        actor: 'user:user-001',
        actorType: 'user',
        isAdmin: false,
      }),
    );
  });

  it('marks isAdmin true when the token role is "admin"', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-001',
      tenantId: 'tenant-001',
      environment: 'PRODUCTION',
      tier: 'ENTERPRISE',
      role: 'admin',
    });
    const { context, req } = makeContext({
      authorization: 'Bearer good-token',
    });
    await guard.canActivate(context);
    expect(req._billinxContext.isAdmin).toBe(true);
  });

  it('preserves a caller-supplied x-request-id instead of generating a new one', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-001',
      tenantId: 'tenant-001',
      environment: 'PRODUCTION',
      tier: 'STANDARD',
      role: 'member',
    });
    const { context, req } = makeContext({
      authorization: 'Bearer good-token',
      'x-request-id': 'req-123',
    });
    await guard.canActivate(context);
    expect(req._billinxContext.requestId).toBe('req-123');
  });
});
