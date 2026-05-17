import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../shared/redis/redis.service';
import { submissionQueue } from '../modules/submission/queues/submission.queue';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health check with latency metrics — used by load balancer',
  })
  async health() {
    const dbStart = Date.now();
    const database = await this.prisma.$queryRaw`SELECT 1`
      .then(() => ({ status: 'connected', latencyMs: Date.now() - dbStart }))
      .catch(() => ({
        status: 'unavailable',
        latencyMs: Date.now() - dbStart,
      }));

    const redisStart = Date.now();
    const redisResult = await this.redis.client
      .ping()
      .then((r) => ({
        status: r === 'PONG' ? 'connected' : 'unavailable',
        latencyMs: Date.now() - redisStart,
      }))
      .catch(() => ({
        status: 'unavailable',
        latencyMs: Date.now() - redisStart,
      }));

    let queueDepth = 0;
    try {
      const counts = await submissionQueue.getJobCounts();
      queueDepth =
        (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    } catch {
      queueDepth = -1;
    }

    const pkg = require('../../package.json') as { version: string };
    const isHealthy =
      database.status === 'connected' && redisResult.status === 'connected';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: pkg.version,
      environment: process.env.NODE_ENV ?? 'development',
      uptime: Math.floor(process.uptime()),
      database: {
        status: database.status,
        latencyMs: database.latencyMs,
      },
      redis: {
        status: redisResult.status,
        latencyMs: redisResult.latencyMs,
      },
      queue: {
        depth: queueDepth,
      },
    };
  }
}
