/// <reference types="jest" />

import * as bcrypt from 'bcrypt';
import { ExecutionContext } from '@nestjs/common';
import { AdminKeyGuard } from './admin-key.guard';

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

describe('AdminKeyGuard', () => {
  let prisma: { $queryRaw: jest.Mock };
  let guard: AdminKeyGuard;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    guard = new AdminKeyGuard(prisma as any);
  });

  it('throws UnauthorizedException when the X-Admin-Key header is missing', async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing X-Admin-Key header',
    );
  });

  it('throws UnauthorizedException when no admin key row matches the prefix', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const { context } = makeContext({
      'x-admin-key': 'abcdefghijklmnopqrstuvwxyz',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid admin key',
    );
  });

  it('throws UnauthorizedException when the key does not bcrypt-match the stored hash', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'admin-1', keyHash: 'wrong-hash' },
    ]);
    const { context } = makeContext({
      'x-admin-key': 'abcdefghijklmnopqrstuvwxyz',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid admin key',
    );
  });

  it('grants access and sets an admin request context on a valid key', async () => {
    const adminKey = 'abcdefghijklmnopqrstuvwxyz';
    const hash = await bcrypt.hash(adminKey, 10);
    prisma.$queryRaw.mockResolvedValue([{ id: 'admin-1', keyHash: hash }]);
    const { context, req } = makeContext({ 'x-admin-key': adminKey });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req._billinxContext).toEqual(
      expect.objectContaining({
        tenantId: 'ADMIN',
        actor: 'admin:admin-1',
        actorType: 'admin',
        isAdmin: true,
      }),
    );
  });
});
