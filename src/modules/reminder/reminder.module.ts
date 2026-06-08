import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ReminderController } from './reminder.controller';
import { ReminderService } from './services/reminder.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TokenService } from '../identity/services/token.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [EventEmitterModule, EmailModule],
  controllers: [ReminderController],
  providers: [
    ReminderService,
    JwtGuard,
    RolesGuard,
    TokenService,
    ApiKeyService,
    SecretsService,
  ],
  exports: [ReminderService],
})
export class ReminderModule {}
