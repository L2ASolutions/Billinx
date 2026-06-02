import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentProviderService } from './payment.service';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports: [InvoiceModule],
  controllers: [PaymentController],
  providers: [PaymentProviderService],
})
export class PaymentModule {}
