import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './services/invoice.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { IrnService } from './services/irn.service';
import { StateMachineService } from './services/state-machine.service';
import { XmlInvoiceBuilder } from './services/xml-invoice.builder';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ActivityService } from '../activity/services/activity.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { SubmissionService } from '../submission/services/submission.service';
import { MockAdapter } from '../submission/adapters/mock/mock.adapter';
import { InterswitchAdapter } from '../submission/adapters/interswitch/interswitch.adapter';

@Module({
  imports: [EventEmitterModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    InvoiceRepository,
    IrnService,
    StateMachineService,
    XmlInvoiceBuilder,
    PrismaService,
    SecretsService,
    ActivityService,
    ApiKeyService,
    TokenService,
    ApiKeyGuard,
    JwtGuard,
    SubmissionService,
    MockAdapter,
    InterswitchAdapter,
  ],
  exports: [InvoiceService, InvoiceRepository],
})
export class InvoiceModule {}
