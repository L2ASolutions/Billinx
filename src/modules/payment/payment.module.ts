import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentProviderService } from './payment.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { EmailModule } from '../../shared/email/email.module';
import { RedisService } from '../../shared/redis/redis.service';
import { PaymentRateLimitGuard } from '../../shared/guards/payment-rate-limit.guard';

@Module({
  imports: [InvoiceModule, EmailModule],
  controllers: [PaymentController],
  providers: [PaymentProviderService, RedisService, PaymentRateLimitGuard],
})
export class PaymentModule {}
