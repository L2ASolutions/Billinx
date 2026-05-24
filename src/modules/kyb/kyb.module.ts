import { Module } from '@nestjs/common';
import { KybController } from './kyb.controller';
import { KybService } from './services/kyb.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

@Module({
  controllers: [KybController],
  providers: [KybService, AdminJwtGuard],
  exports: [KybService],
})
export class KybModule {}
