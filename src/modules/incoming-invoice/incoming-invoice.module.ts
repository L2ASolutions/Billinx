import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IncomingInvoiceController } from './incoming-invoice.controller';
import { IncomingInvoiceService } from './incoming-invoice.service';
import { IdentityModule } from '../identity/identity.module';
import { ActivityModule } from '../activity/activity.module';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';

@Module({
  imports: [IdentityModule, ActivityModule, EventEmitterModule],
  controllers: [IncomingInvoiceController],
  providers: [IncomingInvoiceService, SecretsService],
  exports: [IncomingInvoiceService],
})
export class IncomingInvoiceModule {}
