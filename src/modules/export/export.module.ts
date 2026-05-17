import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

@Module({
  providers: [ExportService, PrismaService, RedisService],
  exports: [ExportService],
})
export class ExportModule {}
