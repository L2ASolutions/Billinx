import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RedisService } from '../shared/redis/redis.service';

@Module({
  controllers: [HealthController],
  providers: [RedisService],
})
export class HealthModule {}
