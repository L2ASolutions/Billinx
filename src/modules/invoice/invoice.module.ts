import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvoiceController } from './invoice.controller';
import { BulkInvoiceController } from './bulk/bulk-invoice.controller';
import { BulkInvoiceService } from './bulk/bulk-invoice.service';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { IrnService } from './services/irn.service';
import { StateMachineService } from './services/state-machine.service';
import { XmlInvoiceBuilder } from './services/xml-invoice.builder';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { SubmissionService } from '../submission/services/submission.service';
import { MockAdapter } from '../submission/adapters/mock/mock.adapter';
import { InterswitchAdapter } from '../submission/adapters/interswitch/interswitch.adapter';
import { ExportService } from '../export/export.service';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailModule } from '../../shared/email/email.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [EventEmitterModule, EmailModule, TenantModule],
  controllers: [InvoiceController, BulkInvoiceController],
  providers: [
    InvoiceService,
    PaymentService,
    BulkInvoiceService,
    InvoiceRepository,
    IrnService,
    StateMachineService,
    XmlInvoiceBuilder,
    SecretsService,
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
    SubmissionService,
    MockAdapter,
    InterswitchAdapter,
    ExportService,
    RedisService,
  ],
  exports: [InvoiceService, InvoiceRepository],
})
export class InvoiceModule {}
