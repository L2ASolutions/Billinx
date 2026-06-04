import { Module } from '@nestjs/common';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { IdentityModule } from '../identity/identity.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [IdentityModule, ActivityModule],
  controllers: [ClientController],
  providers: [ClientService, SecretsService],
  exports: [ClientService],
})
export class ClientModule {}
