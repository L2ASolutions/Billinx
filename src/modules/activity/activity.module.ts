import { Module, Global } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './services/activity.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { ApiKeyService } from '../identity/services/api-key.service';
import { TokenService } from '../identity/services/token.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { FlexAuthGuard } from '../identity/guards/flex-auth.guard';
import { EmailModule } from '../../shared/email/email.module';

@Global()
@Module({
  imports: [EmailModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    SecretsService,
    ApiKeyService,
    TokenService,
    JwtGuard,
    AdminJwtGuard,
    AdminKeyGuard,
    ApiKeyGuard,
    FlexAuthGuard,
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
