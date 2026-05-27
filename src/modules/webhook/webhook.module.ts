import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './services/webhook.service';
import { WebhookRepository } from './repositories/webhook.repository';
import { WebhookWorker } from './workers/webhook.worker';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { CredentialService } from '../tenant/services/credential.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { FlexAuthGuard } from '../identity/guards/flex-auth.guard';
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
    TokenService,
    JwtGuard,
    ApiKeyGuard,
    FlexAuthGuard,
  ],
  exports: [WebhookService],
})
export class WebhookModule {}
