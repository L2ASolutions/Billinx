import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Module({
  providers: [ConsentService, PrismaService],
  exports: [ConsentService],
})
export class ConsentModule {}
