import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { ApiKeyService } from "./services/api-key.service";
import { TokenService } from "./services/token.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { JwtGuard } from "./guards/jwt.guard";
import { AdminKeyGuard } from "./guards/admin-key.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SecretsService } from "../../infrastructure/secrets/secrets.service";

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