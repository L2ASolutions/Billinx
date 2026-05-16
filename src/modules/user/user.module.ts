import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./services/user.service";
import { UserRepository } from "./repositories/user.repository";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SecretsService } from "../../infrastructure/secrets/secrets.service";
import { ActivityService } from "../activity/services/activity.service";
import { ApiKeyService } from "../identity/services/api-key.service";
import { TokenService } from "../identity/services/token.service";
import { JwtGuard } from "../identity/guards/jwt.guard";
import { AdminKeyGuard } from "../identity/guards/admin-key.guard";
import { RedisService } from "../../shared/redis/redis.service";
import { AuthRateLimitGuard } from "../../shared/guards/auth-rate-limit.guard";
import { EmailService } from "../../shared/email/email.service";
import { MfaService } from "./services/mfa.service";
import { CredentialService } from "../tenant/services/credential.service";

@Module({
  controllers: [UserController],
  providers: [
    UserService,
    UserRepository,
    PrismaService,
    SecretsService,
    ActivityService,
    ApiKeyService,
    TokenService,
    JwtGuard,
    AdminKeyGuard,
    RedisService,
    AuthRateLimitGuard,
    EmailService,
    MfaService,
    CredentialService,
  ],
  exports: [UserService, UserRepository],
})
export class UserModule {}