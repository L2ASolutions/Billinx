import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../shared/redis/redis.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class HealthModule {}
