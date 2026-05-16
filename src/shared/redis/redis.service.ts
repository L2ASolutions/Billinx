import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_SECS = 15 * 60; // 15 minutes

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD ?? undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
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
    } catch {
      // Fail open — a Redis outage should not cause an API outage
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
    } catch {
      return { count: 0, locked: false, retryAfterSecs: 0 };
    }
  }

  async getLockoutStatus(
    tenantId: string,
    email: string,
  ): Promise<{ locked: boolean; retryAfterSecs: number; failedAttempts: number }> {
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
    } catch {
      return { locked: false, retryAfterSecs: 0, failedAttempts: 0 };
    }
  }

  async clearLoginFailures(tenantId: string, email: string): Promise<void> {
    try {
      await this.client.del(this.failureKey(tenantId, email));
    } catch { /* no-op */ }
  }

  private failureKey(tenantId: string, email: string): string {
    return `login:attempts:${tenantId}:${email.toLowerCase().trim()}`;
  }
}
