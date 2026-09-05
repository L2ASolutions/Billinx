import { Module } from '@nestjs/common';
import { SupportTicketsController } from './support-tickets.controller';
import { SupportTicketsAdminController } from './support-tickets-admin.controller';
import { SupportTicketService } from './support-ticket.service';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { EmailModule } from '../../shared/email/email.module';
import { OptionalJwtGuard } from '../identity/guards/optional-jwt.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { TokenService } from '../identity/services/token.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { SupportTicketRateLimitGuard } from '../../shared/guards/support-ticket-rate-limit.guard';
import { RedisService } from '../../shared/redis/redis.service';

@Module({
  imports: [StorageModule, EmailModule],
  controllers: [SupportTicketsController, SupportTicketsAdminController],
  providers: [
    SupportTicketService,
    OptionalJwtGuard,
    JwtGuard,
    TokenService,
    SecretsService,
    AdminJwtGuard,
    SupportTicketRateLimitGuard,
    RedisService,
  ],
})
export class SupportTicketsModule {}
