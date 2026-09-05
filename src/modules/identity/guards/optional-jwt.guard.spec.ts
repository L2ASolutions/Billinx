/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { JwtGuard } from './jwt.guard';

function makeContext(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

describe('OptionalJwtGuard', () => {
  let jwtGuard: { canActivate: jest.Mock };
  let guard: OptionalJwtGuard;

  beforeEach(() => {
    jwtGuard = { canActivate: jest.fn() };
    guard = new OptionalJwtGuard(jwtGuard as unknown as JwtGuard);
  });

  it('returns true when JwtGuard succeeds', async () => {
    jwtGuard.canActivate.mockResolvedValue(true);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('returns true (treats as anonymous) when JwtGuard throws UnauthorizedException for a missing token', async () => {
    jwtGuard.canActivate.mockRejectedValue(
      new UnauthorizedException('Missing Authorization header'),
    );
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('returns true (treats as anonymous) when JwtGuard throws UnauthorizedException for an expired/invalid token', async () => {
    jwtGuard.canActivate.mockRejectedValue(
      new UnauthorizedException('Access token expired'),
    );
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('rethrows a non-token-related error instead of swallowing it', async () => {
    jwtGuard.canActivate.mockRejectedValue(
      new Error('Secrets Manager unavailable'),
    );
    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      'Secrets Manager unavailable',
    );
  });
});
