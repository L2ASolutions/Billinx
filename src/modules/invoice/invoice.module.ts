import { Module } from "@nestjs/common";
import { InvoiceController } from "./invoice.controller";
import { InvoiceService } from "./services/invoice.service";
import { InvoiceRepository } from "./repositories/invoice.repository";
import { IrnService } from "./services/irn.service";
import { StateMachineService } from "./services/state-machine.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SecretsService } from "../../infrastructure/secrets/secrets.service";
import { ActivityService } from "../activity/services/activity.service";
import { ApiKeyService } from "../identity/services/api-key.service";
import { TokenService } from "../identity/services/token.service";
import { ApiKeyGuard } from "../identity/guards/api-key.guard";
import { JwtGuard } from "../identity/guards/jwt.guard";

@Module({
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    InvoiceRepository,
    IrnService,
    StateMachineService,
    PrismaService,
    SecretsService,
    ActivityService,
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
  ],
  exports: [InvoiceService, InvoiceRepository],
})
export class InvoiceModule {}