import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './services/tenant.service';
import { TenantRepository } from './repositories/tenant.repository';
import { CredentialService } from './services/credential.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';

@Module({
  controllers: [TenantController],
  providers: [
    TenantService,
    TenantRepository,
    CredentialService,
    PrismaService,
    SecretsService,
    AdminKeyGuard,
  ],
  exports: [TenantService, TenantRepository, CredentialService],
})
export class TenantModule {}
