import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './services/webhook.service';
import { WebhookRepository } from './repositories/webhook.repository';
import { WebhookWorker } from './workers/webhook.worker';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { CredentialService } from '../tenant/services/credential.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookRepository,
    WebhookWorker,
    SecretsService,
    CredentialService,
    ApiKeyService,
  ],
  exports: [WebhookService],
})
export class WebhookModule {}
