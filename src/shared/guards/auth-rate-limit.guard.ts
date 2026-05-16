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

const AUTH_LIMIT = 5;
const AUTH_WINDOW_SECS = 15 * 60; // 15 minutes

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AuthRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = this.extractIp(req);
    const key = `rl:auth:ip:${ip}`;

    const { allowed, remaining, retryAfter } = await this.redisService.checkRateLimit(
      key,
      AUTH_LIMIT,
      AUTH_WINDOW_SECS,
    );

    res.setHeader('X-RateLimit-Limit', AUTH_LIMIT);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Auth rate limit exceeded for IP ${ip}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many authentication attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
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
      : (forwarded?.split(',')[0] ?? req.socket?.remoteAddress ?? req.ip ?? '0.0.0.0');
    // Normalise IPv6-mapped IPv4: ::ffff:1.2.3.4 → 1.2.3.4
    return raw.trim().replace(/^::ffff:/, '');
  }
}
