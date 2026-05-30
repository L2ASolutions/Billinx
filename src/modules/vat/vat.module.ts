import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { VatController } from './vat.controller';
import { VatService } from './vat.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule, EventEmitterModule],
  controllers: [VatController],
  providers: [VatService, PrismaService],
  exports: [VatService],
})
export class VatModule {}
