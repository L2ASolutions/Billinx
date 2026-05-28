import { Module } from '@nestjs/common';
import { ProductCatalogController } from './product-catalog.controller';
import { ProductCatalogService } from './product-catalog.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { IdentityModule } from '../identity/identity.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [IdentityModule, ActivityModule],
  controllers: [ProductCatalogController],
  providers: [ProductCatalogService, SecretsService],
  exports: [ProductCatalogService],
})
export class ProductCatalogModule {}
