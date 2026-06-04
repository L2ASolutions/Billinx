import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { EmailModule } from '../../shared/email/email.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [EmailModule, IdentityModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
