import { Module } from '@nestjs/common';
import { ProductCatalogController } from './product-catalog.controller';
import { ProductCatalogService } from './product-catalog.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SecretsService } from '../../infrastructure/secrets/secrets.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [ProductCatalogController],
  providers: [ProductCatalogService, PrismaService, SecretsService],
  exports: [ProductCatalogService],
})
export class ProductCatalogModule {}
