import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { CorrelationIdMiddleware } from './shared/middleware/correlation-id.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisService } from './shared/redis/redis.service';
import { RetentionModule } from './shared/retention/retention.module';
import { RecoveryModule } from './shared/recovery/recovery.module';
import { TenantRateLimitInterceptor } from './shared/interceptors/tenant-rate-limit.interceptor';
import { IdentityModule } from './modules/identity/identity.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { ActivityModule } from './modules/activity/activity.module';
import { UserModule } from './modules/user/user.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { SubmissionModule } from './modules/submission/submission.module';
import { AdminModule } from './modules/admin/admin.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { EmailModule } from './shared/email/email.module';
import { HealthModule } from './health/health.module';
import { KybModule } from './modules/kyb/kyb.module';
import { ConsentModule } from './modules/consent/consent.module';
import { ProductCatalogModule } from './modules/product-catalog/product-catalog.module';
import { ExportModule } from './modules/export/export.module';
import { ReminderModule } from './modules/reminder/reminder.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { SecretsService } from './infrastructure/secrets/secrets.service';
import { IdempotencyInterceptor } from './shared/interceptors/idempotency.interceptor';
import { AuditLogInterceptor } from './shared/interceptors/audit-log.interceptor';
import { RequestContextInterceptor } from './shared/interceptors/request-context.interceptor';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';

@Module({
  imports: [
    DatabaseModule,
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.' }),
    ScheduleModule.forRoot(),
    RetentionModule,
    RecoveryModule,
    IdentityModule,
    TenantModule,
    ActivityModule,
    UserModule,
    InvoiceModule,
    SubmissionModule,
    AdminModule,
    WebhookModule,
    EmailModule,
    HealthModule,
    KybModule,
    ConsentModule,
    ProductCatalogModule,
    ExportModule,
    ReminderModule,
  ],
  providers: [
    SecretsService,
    RedisService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantRateLimitInterceptor,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
