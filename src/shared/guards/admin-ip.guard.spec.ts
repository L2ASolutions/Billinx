/// <reference types="jest" />

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminIpGuard } from './admin-ip.guard';

function makeContext(
  headers: Record<string, string> = {},
  ip = '',
): ExecutionContext {
  const req: any = { headers, ip };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AdminIpGuard', () => {
  const ORIGINAL_ENV = process.env.ADMIN_ALLOWED_IPS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ADMIN_ALLOWED_IPS;
    } else {
      process.env.ADMIN_ALLOWED_IPS = ORIGINAL_ENV;
    }
  });

  it('fails open (allows any IP) when ADMIN_ALLOWED_IPS is not set', () => {
    delete process.env.ADMIN_ALLOWED_IPS;
    const guard = new AdminIpGuard();

    expect(guard.canActivate(makeContext({}, '203.0.113.5'))).toBe(true);
  });

  describe('with an allowlist configured', () => {
    it('allows an exact IP match', () => {
      process.env.ADMIN_ALLOWED_IPS = '10.0.0.5,10.0.0.6';
      const guard = new AdminIpGuard();

      expect(guard.canActivate(makeContext({}, '10.0.0.5'))).toBe(true);
    });

    it('denies an IP not in the allowlist', () => {
      process.env.ADMIN_ALLOWED_IPS = '10.0.0.5';
      const guard = new AdminIpGuard();

      expect(() => guard.canActivate(makeContext({}, '203.0.113.5'))).toThrow(
        ForbiddenException,
      );
    });

    it('reads the client IP from X-Forwarded-For, preferring it over req.ip', () => {
      process.env.ADMIN_ALLOWED_IPS = '10.0.0.5';
      const guard = new AdminIpGuard();

      expect(
        guard.canActivate(
          makeContext(
            { 'x-forwarded-for': '10.0.0.5, 70.1.2.3' },
            '203.0.113.5',
          ),
        ),
      ).toBe(true);
    });

    it('allows an IP within an allowlisted CIDR range', () => {
      process.env.ADMIN_ALLOWED_IPS = '192.168.1.0/24';
      const guard = new AdminIpGuard();

      expect(guard.canActivate(makeContext({}, '192.168.1.200'))).toBe(true);
    });

    it('denies an IP outside an allowlisted CIDR range', () => {
      process.env.ADMIN_ALLOWED_IPS = '192.168.1.0/24';
      const guard = new AdminIpGuard();

      expect(() => guard.canActivate(makeContext({}, '192.168.2.1'))).toThrow(
        ForbiddenException,
      );
    });

    it('treats a bare /32 CIDR as an exact-match single host', () => {
      process.env.ADMIN_ALLOWED_IPS = '10.0.0.5/32';
      const guard = new AdminIpGuard();

      expect(guard.canActivate(makeContext({}, '10.0.0.5'))).toBe(true);
      expect(() => guard.canActivate(makeContext({}, '10.0.0.6'))).toThrow(
        ForbiddenException,
      );
    });

    it('a /0 CIDR matches every IP', () => {
      process.env.ADMIN_ALLOWED_IPS = '0.0.0.0/0';
      const guard = new AdminIpGuard();

      expect(guard.canActivate(makeContext({}, '8.8.8.8'))).toBe(true);
    });
  });
});
