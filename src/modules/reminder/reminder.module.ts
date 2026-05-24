import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ReminderController } from './reminder.controller';
import { ReminderService } from './services/reminder.service';
import { ActivityService } from '../activity/services/activity.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { TokenService } from '../identity/services/token.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [EventEmitterModule, EmailModule],
  controllers: [ReminderController],
  providers: [
    ReminderService,
    ActivityService,
    JwtGuard,
    TokenService,
    ApiKeyService,
    SecretsService,
  ],
  exports: [ReminderService],
})
export class ReminderModule {}
