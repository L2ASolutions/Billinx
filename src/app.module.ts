import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_FILTER } from "@nestjs/core";
import { IdentityModule } from "./modules/identity/identity.module";
import { PrismaService } from "./infrastructure/database/prisma.service";
import { SecretsService } from "./infrastructure/secrets/secrets.service";
import { IdempotencyInterceptor } from "./shared/interceptors/idempotency.interceptor";
import { AuditLogInterceptor } from "./shared/interceptors/audit-log.interceptor";
import { GlobalExceptionFilter } from "./shared/filters/global-exception.filter";

@Module({
  imports: [IdentityModule],
  providers: [
    PrismaService,
    SecretsService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}