import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SecretsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
