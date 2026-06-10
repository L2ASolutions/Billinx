import {
  Injectable,
  OnModuleDestroy,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { buildRedisConnectionOptions } from './redis-config.factory';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_SECS = 15 * 60; // 15 minutes

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis({
      ...buildRedisConnectionOptions(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });

    this.client.on('error', (err) =>
      this.logger.warn(`Redis connection error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => null);
  }

  // ─── Fixed-window rate limiting ───────────────────────────────────────────

  async checkRateLimit(
    key: string,
    limit: number,
    windowSecs: number,
    options: { failClosed?: boolean } = {},
  ): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, windowSecs);
      }
      if (count > limit) {
        const ttl = await this.client.ttl(key);
        return { allowed: false, remaining: 0, retryAfter: Math.max(ttl, 1) };
      }
      return { allowed: true, remaining: limit - count, retryAfter: 0 };
    } catch (err) {
      this.logger.error(
        `Redis unavailable during rate-limit check for key "${key}": ${(err as Error).message}`,
      );
      if (options.failClosed) {
        // Auth endpoints must never fail open — a Redis outage blocks auth rather than allowing unlimited attempts
        throw new ServiceUnavailableException(
          'Authentication service temporarily unavailable. Please retry shortly.',
        );
      }
      // Non-auth rate limits fail open to avoid an API outage during Redis downtime
      return { allowed: true, remaining: limit, retryAfter: 0 };
    }
  }

  // ─── Account lockout ──────────────────────────────────────────────────────

  async recordLoginFailure(
    tenantId: string,
    email: string,
  ): Promise<{ count: number; locked: boolean; retryAfterSecs: number }> {
    const key = this.failureKey(tenantId, email);
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, LOCKOUT_WINDOW_SECS);
      }
      const ttl = await this.client.ttl(key);
      return {
        count,
        locked: count >= LOCKOUT_THRESHOLD,
        retryAfterSecs: count >= LOCKOUT_THRESHOLD ? Math.max(ttl, 1) : 0,
      };
    } catch (err) {
      this.logger.error(
        `Redis unavailable during login failure recording: ${(err as Error).message}`,
      );
      // Fail closed: if we cannot record the failure we cannot enforce the lockout,
      // so deny the request to prevent brute-force during a Redis outage.
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable. Please retry shortly.',
      );
    }
  }

  async getLockoutStatus(
    tenantId: string,
    email: string,
  ): Promise<{
    locked: boolean;
    retryAfterSecs: number;
    failedAttempts: number;
  }> {
    const key = this.failureKey(tenantId, email);
    try {
      const [raw, ttl] = await Promise.all([
        this.client.get(key),
        this.client.ttl(key),
      ]);
      const count = parseInt(raw ?? '0', 10);
      const locked = count >= LOCKOUT_THRESHOLD;
      return {
        locked,
        retryAfterSecs: locked ? Math.max(ttl, 1) : 0,
        failedAttempts: count,
      };
    } catch (err) {
      this.logger.error(
        `Redis unavailable during lockout status check: ${(err as Error).message}`,
      );
      // Fail closed: cannot verify lockout state, so block the attempt
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable. Please retry shortly.',
      );
    }
  }

  async clearLoginFailures(tenantId: string, email: string): Promise<void> {
    try {
      await this.client.del(this.failureKey(tenantId, email));
    } catch {
      /* no-op */
    }
  }

  private failureKey(tenantId: string, email: string): string {
    return `login:attempts:${tenantId}:${email.toLowerCase().trim()}`;
  }
}
