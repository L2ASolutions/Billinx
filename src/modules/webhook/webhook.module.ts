import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './services/webhook.service';
import { WebhookRepository } from './repositories/webhook.repository';
import { WebhookWorker } from './workers/webhook.worker';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { CredentialService } from '../tenant/services/credential.service';
import { ApiKeyService } from '../identity/services/api-key.service';

@Module({
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookRepository,
    WebhookWorker,
    PrismaService,
    SecretsService,
    CredentialService,
    ApiKeyService,
  ],
  exports: [WebhookService],
})
export class WebhookModule {}
