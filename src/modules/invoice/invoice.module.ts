import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvoiceApiController } from './invoice-api.controller';
import { InvoiceExportController } from './invoice-export.controller';
import { InvoiceDashboardController } from './invoice-dashboard.controller';
import { InvoicePublicController } from './invoice-public.controller';
import { BulkInvoiceController } from './bulk/bulk-invoice.controller';
import { CreditNoteController } from './credit-note.controller';
import { VatReturnController } from './vat-return.controller';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { VatReminderProcessor } from './vat-reminder.processor';
import { VatReminderScheduler } from './vat-reminder.scheduler';
import { RecurringInvoiceScheduler } from './recurring-invoice.scheduler';
import { BulkInvoiceService } from './bulk/bulk-invoice.service';
import { CreditNoteService } from './credit-note.service';
import { VatReturnService } from './vat-return.service';
import { InvoiceService } from './services/invoice.service';
import { InvoiceValidationService } from './services/invoice-validation.service';
import { RecurringInvoiceService } from './services/recurring-invoice.service';
import { PaymentService } from './services/payment.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { IrnService } from './services/irn.service';
import { StateMachineService } from './services/state-machine.service';
import { XmlInvoiceBuilder } from './services/xml-invoice.builder';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { SubmissionService } from '../submission/services/submission.service';
import { MockAdapter } from '../submission/adapters/mock/mock.adapter';
import { InterswitchAdapter } from '../submission/adapters/interswitch/interswitch.adapter';
import { ExportService } from '../export/export.service';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailModule } from '../../shared/email/email.module';
import { TenantModule } from '../tenant/tenant.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    EventEmitterModule,
    EmailModule,
    TenantModule,
    InventoryModule,
    NotificationModule,
  ],
  controllers: [
    // RecurringInvoiceController MUST be registered before InvoiceApiController:
    // InvoiceApiController's ApiKeyGuard-protected GET(':id') is a single-segment
    // catch-all on the same v1/invoices prefix, and Nest/Express resolves
    // overlapping route patterns across controllers in registration order, not
    // by pattern specificity. Registered later, GET v1/invoices/recurring would
    // be shadowed by that :id route and 401 for every JWT-authenticated caller.
    RecurringInvoiceController,
    CreditNoteController,
    VatReturnController,
    InvoiceApiController,
    InvoiceExportController,
    InvoiceDashboardController,
    InvoicePublicController,
    BulkInvoiceController,
  ],
  providers: [
    InvoiceService,
    InvoiceValidationService,
    RecurringInvoiceService,
    CreditNoteService,
    VatReturnService,
    PaymentService,
    BulkInvoiceService,
    InvoiceRepository,
    IrnService,
    StateMachineService,
    XmlInvoiceBuilder,
    InvoicePdfService,
    SecretsService,
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
    RolesGuard,
    SubmissionService,
    MockAdapter,
    InterswitchAdapter,
    ExportService,
    RedisService,
    VatReminderProcessor,
    VatReminderScheduler,
    RecurringInvoiceScheduler,
  ],
  exports: [InvoiceService, InvoiceRepository, PaymentService],
})
export class InvoiceModule {}
