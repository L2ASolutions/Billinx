import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubmissionService } from './services/submission.service';
import { SubmissionWorker } from './workers/submission.worker';
import { MockAdapter } from './adapters/mock/mock.adapter';
import { InterswitchAdapter } from './adapters/interswitch/interswitch.adapter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ActivityService } from '../activity/services/activity.service';
import { CredentialService } from '../tenant/services/credential.service';

@Module({
  imports: [EventEmitterModule],
  providers: [
    SubmissionService,
    SubmissionWorker,
    MockAdapter,
    InterswitchAdapter,
    PrismaService,
    SecretsService,
    ActivityService,
    CredentialService,
  ],
  exports: [SubmissionService],
})
export class SubmissionModule {}
