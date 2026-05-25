import { Module, Global } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './services/activity.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { EmailModule } from '../../shared/email/email.module';

@Global()
@Module({
  imports: [EmailModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    SecretsService,
    ApiKeyService,
    AdminJwtGuard,
    AdminKeyGuard,
    ApiKeyGuard,
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
