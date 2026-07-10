import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AdminIpGuard implements CanActivate {
  private readonly logger = new Logger(AdminIpGuard.name);
  private readonly allowlist: string[] | null = null;

  constructor() {
    const raw = process.env.ADMIN_ALLOWED_IPS;
    if (raw) {
      this.allowlist = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      this.logger.warn(
        'ADMIN_ALLOWED_IPS is not set — admin routes are accessible from any IP',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.allowlist) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException(
          'Admin routes are disabled: ADMIN_ALLOWED_IPS is not configured',
        );
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      '';

    if (this.isAllowed(clientIp)) return true;

    this.logger.warn(`Admin access denied for IP: ${clientIp}`);
    throw new ForbiddenException('Access denied: IP not in admin allowlist');
  }

  private isAllowed(ip: string): boolean {
    for (const entry of this.allowlist!) {
      if (entry.includes('/')) {
        if (this.ipInCidr(ip, entry)) return true;
      } else {
        if (ip === entry) return true;
      }
    }
    return false;
  }

  private ipToNum(ip: string): number {
    return (
      ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>>
      0
    );
  }

  private ipInCidr(ip: string, cidr: string): boolean {
    const [range, bits = '32'] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);
    if (prefixLen < 0 || prefixLen > 32) return false;
    const mask = prefixLen === 0 ? 0 : ~((1 << (32 - prefixLen)) - 1) >>> 0;
    return (this.ipToNum(ip) & mask) === (this.ipToNum(range) & mask);
  }
}
