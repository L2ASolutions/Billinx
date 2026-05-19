import { Module } from '@nestjs/common';
import { RecoveryService } from './recovery.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../../modules/activity/services/activity.service';

@Module({
  providers: [RecoveryService, PrismaService, ActivityService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
