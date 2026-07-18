import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubmissionController } from './submission.controller';
import { SubmissionService } from './services/submission.service';
import { SubmissionWorker } from './workers/submission.worker';
import { BulkSubmissionWorker } from './workers/bulk-submission.worker';
import { UpdateStatusWorker } from './workers/update-status.worker';
import { MockAdapter } from './adapters/mock/mock.adapter';
import { InterswitchAdapter } from './adapters/interswitch/interswitch.adapter';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { CredentialService } from '../tenant/services/credential.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { ClientModule } from '../client/client.module';
import { InventoryModule } from '../inventory/inventory.module';
import { EmailModule } from '../../shared/email/email.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    EventEmitterModule,
    ClientModule,
    InventoryModule,
    EmailModule,
    NotificationModule,
  ],
  controllers: [SubmissionController],
  providers: [
    SubmissionService,
    SubmissionWorker,
    BulkSubmissionWorker,
    UpdateStatusWorker,
    MockAdapter,
    InterswitchAdapter,
    SecretsService,
    CredentialService,
    ApiKeyService,
    TokenService,
    JwtGuard,
    RolesGuard,
  ],
  exports: [SubmissionService],
})
export class SubmissionModule {}
