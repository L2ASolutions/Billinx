import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { RedisService } from "../shared/redis/redis.service";

@ApiTags("Health")
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get("health")
  @ApiOperation({ summary: "Health check — used by load balancer" })
  async health() {
    const [database, redisStatus] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`
        .then(() => "connected")
        .catch(() => "unavailable"),
      this.redis.client
        .ping()
        .then((r) => (r === "PONG" ? "connected" : "unavailable"))
        .catch(() => "unavailable"),
    ]);

    const pkg = require("../../package.json") as { version: string };

    return {
      status: database === "connected" && redisStatus === "connected" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: pkg.version,
      environment: process.env.NODE_ENV ?? "development",
      database,
      redis: redisStatus,
    };
  }
}
