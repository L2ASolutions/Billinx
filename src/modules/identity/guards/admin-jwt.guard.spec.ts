/// <reference types="jest" />

import * as jwt from 'jsonwebtoken';
import { ExecutionContext } from '@nestjs/common';
import { AdminJwtGuard } from './admin-jwt.guard';

const ADMIN_SECRET = 'test-admin-secret';

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

describe('AdminJwtGuard', () => {
  let guard: AdminJwtGuard;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ADMIN_JWT_SECRET: ADMIN_SECRET };
    guard = new AdminJwtGuard();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing admin authorization token',
    );
  });

  it('throws UnauthorizedException for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ isAdmin: true }, 'wrong-secret', {
      expiresIn: '1h',
    });
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired admin token',
    );
  });

  it('throws UnauthorizedException for an expired token', async () => {
    const token = jwt.sign({ isAdmin: true }, ADMIN_SECRET, { expiresIn: -10 });
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired admin token',
    );
  });

  it('throws UnauthorizedException when the token is valid but not marked isAdmin', async () => {
    const token = jwt.sign({ isAdmin: false }, ADMIN_SECRET, {
      expiresIn: '1h',
    });
    const { context } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired admin token',
    );
  });

  it('grants access and sets _adminContext for a valid admin token', async () => {
    const token = jwt.sign(
      {
        isAdmin: true,
        sub: 'admin-1',
        email: 'admin@billinx.ng',
        role: 'SUPER_ADMIN',
      },
      ADMIN_SECRET,
      { expiresIn: '1h' },
    );
    const { context, req } = makeContext({ authorization: `Bearer ${token}` });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req._adminContext).toEqual({
      adminId: 'admin-1',
      email: 'admin@billinx.ng',
      role: 'SUPER_ADMIN',
    });
  });
});
