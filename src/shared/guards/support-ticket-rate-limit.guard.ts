import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';

// Generous enough for a genuine burst of real crash reports from one
// tenant/IP, tight enough that a client stuck in an auto-capture-on-crash
// loop can't turn this into a spam or storage-cost vector.
const TICKET_LIMIT = 10;
const TICKET_WINDOW_SECS = 10 * 60; // 10 minutes

@Injectable()
export class SupportTicketRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SupportTicketRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // OptionalJwtGuard (which runs before this guard) has already populated
    // _billinxContext when a valid token was present — tenant-scope the
    // bucket in that case so one tenant's burst can't throttle another's;
    // fall back to IP for genuinely unauthenticated (pre-auth crash) calls.
    const ctx = (req as any)._billinxContext;
    const bucketKey = ctx?.tenantId
      ? `rl:support-ticket:tenant:${ctx.tenantId}`
      : `rl:support-ticket:ip:${this.extractIp(req)}`;

    const { allowed, remaining, retryAfter } =
      await this.redisService.checkRateLimit(
        bucketKey,
        TICKET_LIMIT,
        TICKET_WINDOW_SECS,
      );

    res.setHeader('X-RateLimit-Limit', TICKET_LIMIT);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Support ticket rate limit exceeded for ${bucketKey}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many support ticket submissions. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded)
      ? forwarded[0]
      : (forwarded?.split(',')[0] ??
        req.socket?.remoteAddress ??
        req.ip ??
        '0.0.0.0');
    return raw.trim().replace(/^::ffff:/, '');
  }
}
