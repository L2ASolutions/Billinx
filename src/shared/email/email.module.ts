import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { InvoiceEmailListener } from './invoice-email.listener';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Module({
  providers: [EmailService, InvoiceEmailListener, PrismaService],
  exports: [EmailService],
})
export class EmailModule {}
