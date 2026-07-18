import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { getRequestContext } from '../../shared/context/request-context';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';

@ApiTags('Inventory')
@Controller('v1/inventory')
@UseGuards(JwtGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List all products with current stock levels' })
  @ApiResponse({
    status: 200,
    description: 'List all products with current stock levels',
  })
  async getStockList(
    @Query('lowStock') lowStock?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = getRequestContext();
    return this.inventoryService.getStockList(ctx.tenantId, {
      lowStock: lowStock === 'true',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get products at or below reorder point' })
  @ApiResponse({
    status: 200,
    description: 'Get products at or below reorder point',
  })
  async getAlerts() {
    const ctx = getRequestContext();
    return this.inventoryService.getAlerts(ctx.tenantId);
  }

  @Get(':productId/movements')
  @ApiOperation({ summary: 'Get stock movement history for a product' })
  @ApiResponse({
    status: 200,
    description: 'Get stock movement history for a product',
  })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getMovements(
    @Param('productId') productId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = getRequestContext();
    return this.inventoryService.getMovements(
      ctx.tenantId,
      productId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Post(':productId/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust stock quantity for a product' })
  @ApiResponse({
    status: 200,
    description: 'Adjust stock quantity for a product',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async adjustStock(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
  ) {
    const ctx = getRequestContext();
    return this.inventoryService.adjustStock(ctx.tenantId, productId, dto);
  }

  @Post(':productId/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send reorder request email to supplier' })
  @ApiResponse({
    status: 200,
    description: 'Send reorder request email to supplier',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async triggerReorder(@Param('productId') productId: string) {
    const ctx = getRequestContext();
    return this.inventoryService.triggerReorder(ctx.tenantId, productId);
  }
}
