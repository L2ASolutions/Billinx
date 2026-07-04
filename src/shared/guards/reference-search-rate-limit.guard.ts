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

// Generous limit: hs-codes/service-codes search is debounced client-side autocomplete
// (300ms), used repeatedly while building an invoice — must not throttle normal typing.
const SEARCH_LIMIT = 60;
const SEARCH_WINDOW_SECS = 5 * 60; // 5 minutes

@Injectable()
export class ReferenceSearchRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ReferenceSearchRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = this.extractIp(req);
    const key = `rl:refsearch:ip:${ip}`;

    const { allowed, remaining, retryAfter } =
      await this.redisService.checkRateLimit(
        key,
        SEARCH_LIMIT,
        SEARCH_WINDOW_SECS,
      );

    res.setHeader('X-RateLimit-Limit', SEARCH_LIMIT);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Reference search rate limit exceeded for IP ${ip}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many search requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
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
