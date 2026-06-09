import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { TokenService } from '../identity/services/token.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, JwtGuard, TokenService, SecretsService],
  exports: [NotificationService],
})
export class NotificationModule {}
