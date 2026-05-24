import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './services/admin.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { AdminIpGuard } from '../../shared/guards/admin-ip.guard';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailService } from '../../shared/email/email.service';
import { ConsentService } from '../consent/consent.service';
import { RetentionService } from '../../shared/retention/retention.service';
import { ExportService } from '../export/export.service';
import { RecoveryModule } from '../../shared/recovery/recovery.module';
import { ReminderModule } from '../reminder/reminder.module';

@Module({
  imports: [RecoveryModule, ReminderModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminJwtGuard,
    SecretsService,
    ApiKeyService,
    AdminKeyGuard,
    AdminIpGuard,
    RedisService,
    EmailService,
    ConsentService,
    RetentionService,
    ExportService,
  ],
  exports: [AdminService],
})
export class AdminModule {}
