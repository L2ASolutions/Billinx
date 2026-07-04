import { Module } from '@nestjs/common';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { ReferenceSearchRateLimitGuard } from '../../shared/guards/reference-search-rate-limit.guard';

@Module({
  controllers: [ReferenceDataController],
  providers: [
    ReferenceDataService,
    PrismaService,
    RedisService,
    ReferenceSearchRateLimitGuard,
  ],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
