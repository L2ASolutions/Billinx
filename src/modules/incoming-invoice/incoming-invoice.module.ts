import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IncomingInvoiceController } from './incoming-invoice.controller';
import { IncomingInvoiceService } from './incoming-invoice.service';
import { IdentityModule } from '../identity/identity.module';
import { ActivityModule } from '../activity/activity.module';
import { EmailModule } from '../../shared/email/email.module';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [IdentityModule, ActivityModule, EventEmitterModule, EmailModule, InventoryModule],
  controllers: [IncomingInvoiceController],
  providers: [IncomingInvoiceService, SecretsService],
  exports: [IncomingInvoiceService],
})
export class IncomingInvoiceModule {}
