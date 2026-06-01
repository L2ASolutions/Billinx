import { Module } from '@nestjs/common';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Module({
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService, PrismaService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
