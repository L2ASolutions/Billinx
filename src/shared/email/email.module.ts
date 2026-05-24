import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { InvoiceEmailListener } from './invoice-email.listener';

@Module({
  providers: [EmailService, InvoiceEmailListener],
  exports: [EmailService],
})
export class EmailModule {}
