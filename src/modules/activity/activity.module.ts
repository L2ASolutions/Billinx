import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './services/activity.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    PrismaService,
    SecretsService,
    ApiKeyService,
    AdminKeyGuard,
    ApiKeyGuard,
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
