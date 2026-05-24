import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { RedisService } from '../../shared/redis/redis.service';

@Module({
  providers: [ExportService, RedisService],
  exports: [ExportService],
})
export class ExportModule {}
