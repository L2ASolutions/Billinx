import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentProviderService } from './payment.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [InvoiceModule, EmailModule],
  controllers: [PaymentController],
  providers: [PaymentProviderService],
})
export class PaymentModule {}
