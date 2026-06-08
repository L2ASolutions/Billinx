import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProductCatalogService } from './product-catalog.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
@ApiTags('Products')
@Controller('v1/products')
export class ProductCatalogController {
  constructor(private readonly productCatalogService: ProductCatalogService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product in the catalog' })
  async createProduct(@Body() body: Record<string, any>, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.createProduct(ctx.tenantId, body);
  }

  @Get()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List products in the catalog' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  async listProducts(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
  ) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.listProducts(ctx.tenantId, {
      search,
      category,
      isActive,
    });
  }

  @Get(':id/as-line-item')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get product formatted as an invoice line item' })
  async getProductAsLineItem(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.getProductAsLineItem(id, ctx.tenantId);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a product by ID' })
  async getProduct(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.getProduct(id, ctx.tenantId);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.updateProduct(id, ctx.tenantId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a product from the catalog' })
  async deleteProduct(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.productCatalogService.deleteProduct(id, ctx.tenantId);
  }
}
