import { Module } from '@nestjs/common';
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

@Module({
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
