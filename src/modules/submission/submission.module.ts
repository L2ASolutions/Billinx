import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubmissionService } from './services/submission.service';
import { SubmissionWorker } from './workers/submission.worker';
import { BulkSubmissionWorker } from './workers/bulk-submission.worker';
import { MockAdapter } from './adapters/mock/mock.adapter';
import { InterswitchAdapter } from './adapters/interswitch/interswitch.adapter';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ActivityService } from '../activity/services/activity.service';
import { CredentialService } from '../tenant/services/credential.service';

@Module({
  imports: [EventEmitterModule],
  providers: [
    SubmissionService,
    SubmissionWorker,
    BulkSubmissionWorker,
    MockAdapter,
    InterswitchAdapter,
    SecretsService,
    ActivityService,
    CredentialService,
  ],
  exports: [SubmissionService],
})
export class SubmissionModule {}
