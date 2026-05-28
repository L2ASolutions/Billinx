import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IdentityController } from './identity.controller';
import { ApiKeyService } from './services/api-key.service';
import { TokenService } from './services/token.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { JwtGuard } from './guards/jwt.guard';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AuthRateLimitGuard } from '../../shared/guards/auth-rate-limit.guard';
import { EmailService } from '../../shared/email/email.service';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [ScheduleModule.forRoot(), ActivityModule],
  controllers: [IdentityController],
  providers: [
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
    AdminKeyGuard,
    SecretsService,
    RedisService,
    AuthRateLimitGuard,
    EmailService,
  ],
  exports: [
    ApiKeyGuard,
    JwtGuard,
    AdminKeyGuard,
    ApiKeyService,
    TokenService,
    SecretsService,
  ],
})
export class IdentityModule {}
