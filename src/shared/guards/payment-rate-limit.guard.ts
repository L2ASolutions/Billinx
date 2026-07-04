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

const PAYMENT_LIMIT = 10;
const PAYMENT_WINDOW_SECS = 5 * 60; // 5 minutes

@Injectable()
export class PaymentRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(PaymentRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = this.extractIp(req);
    const key = `rl:payment:ip:${ip}`;

    const { allowed, remaining, retryAfter } =
      await this.redisService.checkRateLimit(
        key,
        PAYMENT_LIMIT,
        PAYMENT_WINDOW_SECS,
      );

    res.setHeader('X-RateLimit-Limit', PAYMENT_LIMIT);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Payment rate limit exceeded for IP ${ip}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many payment requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
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
