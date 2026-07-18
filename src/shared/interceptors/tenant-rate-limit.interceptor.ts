import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';

const TIER_LIMITS: Record<string, number> = {
  STANDARD: 300,
  PREMIUM: 1000,
  ENTERPRISE: 10_000,
};
// Dashboard/JWT users get a generous separate bucket — they must never
// share quota with API key integrations or trip the limit during normal use.
const JWT_LIMIT = 600;
const WINDOW_SECS = 3600; // 1 hour

@Injectable()
export class TenantRateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantRateLimitInterceptor.name);

  constructor(private readonly redisService: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ctx = (req as any)._billinxContext;
    if (!ctx?.tenantId) return next.handle();

    const isJwtUser = ctx.actorType === 'user';
    const isApiKey = ctx.actorType === 'apikey';
    const tier: string = ctx.tier ?? 'STANDARD';
    const limit = isJwtUser
      ? JWT_LIMIT
      : (TIER_LIMITS[tier] ?? TIER_LIMITS.STANDARD);
    const hourBucket = Math.floor(Date.now() / (WINDOW_SECS * 1000));
    // Separate Redis keys so JWT dashboard calls never consume API key quota.
    // Each API key gets its own bucket (keyed by keyId, not tenantId) — up to
    // the tenant's tier limit each — so a noisy or leaked key can't throttle
    // every other integration under the same tenant.
    const key = isJwtUser
      ? `rl:dashboard:tenant:${ctx.tenantId}:${hourBucket}`
      : isApiKey
        ? `rl:api:key:${ctx.actor.replace('apikey:', '')}:${hourBucket}`
        : `rl:api:tenant:${ctx.tenantId}:${hourBucket}`;

    const { allowed, remaining, retryAfter } =
      await this.redisService.checkRateLimit(key, limit, WINDOW_SECS);

    const resetAt = (hourBucket + 1) * WINDOW_SECS;

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetAt);
    res.setHeader('X-RateLimit-Tier', tier);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter);
      this.logger.warn(
        `Tenant rate limit exceeded: tenantId=${ctx.tenantId} tier=${tier} limit=${limit}/hr`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded for ${tier} tier (${limit} requests/hour). Retry after ${retryAfter} second(s).`,
          retryAfter,
          tier,
          limit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return next.handle();
  }
}
