import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Get('top-items-sold')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top 10 items sold by revenue (outgoing invoices)' })
  @ApiQuery({ name: 'period', required: false, enum: ['month', 'quarter', 'year'] })
  async topItemsSold(@Req() req: Request, @Query('period') period?: string) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topItemsSold(ctx.tenantId, period);
  }

  @Get('top-purchases')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top 10 purchased items by spend (incoming invoices)' })
  @ApiQuery({ name: 'period', required: false, enum: ['month', 'quarter', 'year'] })
  async topPurchases(@Req() req: Request, @Query('period') period?: string) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topPurchases(ctx.tenantId, period);
  }

  @Get('top-suppliers')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top suppliers by spend (incoming invoices)' })
  async topSuppliers(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topSuppliers(ctx.tenantId);
  }

  @Get('top-clients')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top clients by revenue (outgoing accepted invoices)' })
  async topClients(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topClients(ctx.tenantId);
  }

  @Get('price-trends')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Price trends for an item over time (incoming invoices)' })
  @ApiQuery({ name: 'itemName', required: true })
  @ApiQuery({ name: 'months', required: false })
  async priceTrends(
    @Req() req: Request,
    @Query('itemName') itemName: string,
    @Query('months') months?: string,
  ) {
    const ctx = this.getCtx(req);
    return this.analyticsService.priceTrends(
      ctx.tenantId,
      itemName,
      months ? parseInt(months, 10) : 6,
    );
  }
}
