import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IdentityController } from './identity.controller';
import { ApiKeyService } from './services/api-key.service';
import { TokenService } from './services/token.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { JwtGuard } from './guards/jwt.guard';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AuthRateLimitGuard } from '../../shared/guards/auth-rate-limit.guard';
import { EmailService } from '../../shared/email/email.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [IdentityController],
  providers: [
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
    AdminKeyGuard,
    PrismaService,
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
    PrismaService,
    SecretsService,
  ],
})
export class IdentityModule {}
