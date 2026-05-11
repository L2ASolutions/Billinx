import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./services/admin.service";
import { AdminJwtGuard } from "./guards/admin-jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SecretsService } from "../../infrastructure/secrets/secrets.service";
import { ApiKeyService } from "../identity/services/api-key.service";
import { AdminKeyGuard } from "../identity/guards/admin-key.guard";

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminJwtGuard,
    PrismaService,
    SecretsService,
    ApiKeyService,
    AdminKeyGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}