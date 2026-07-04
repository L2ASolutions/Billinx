import { Module } from '@nestjs/common';
import { KybController } from './kyb.controller';
import { KybService } from './services/kyb.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { RedisService } from '../../shared/redis/redis.service';
import { AuthRateLimitGuard } from '../../shared/guards/auth-rate-limit.guard';

@Module({
  controllers: [KybController],
  providers: [KybService, AdminJwtGuard, RedisService, AuthRateLimitGuard],
  exports: [KybService],
})
export class KybModule {}
