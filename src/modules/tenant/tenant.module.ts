import { Module, forwardRef } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './services/tenant.service';
import { TenantRepository } from './repositories/tenant.repository';
import { CredentialService } from './services/credential.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { ReminderModule } from '../reminder/reminder.module';

@Module({
  imports: [forwardRef(() => ReminderModule)],
  controllers: [TenantController],
  providers: [
    TenantService,
    TenantRepository,
    CredentialService,
    SecretsService,
    AdminKeyGuard,
  ],
  exports: [TenantService, TenantRepository, CredentialService],
})
export class TenantModule {}
