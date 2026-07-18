import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Reports')
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
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['month', 'quarter', 'year'],
  })
  @ApiResponse({
    status: 200,
    description: 'Top 10 items sold by revenue (outgoing invoices)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async topItemsSold(@Req() req: Request, @Query('period') period?: string) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topItemsSold(ctx.tenantId, period);
  }

  @Get('top-purchases')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Top 10 purchased items by spend (incoming invoices)',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['month', 'quarter', 'year'],
  })
  @ApiResponse({
    status: 200,
    description: 'Top 10 purchased items by spend (incoming invoices)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async topPurchases(@Req() req: Request, @Query('period') period?: string) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topPurchases(ctx.tenantId, period);
  }

  @Get('top-suppliers')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top suppliers by spend (incoming invoices)' })
  @ApiResponse({
    status: 200,
    description: 'Top suppliers by spend (incoming invoices)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async topSuppliers(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topSuppliers(ctx.tenantId);
  }

  @Get('top-clients')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Top clients by revenue (outgoing accepted invoices)',
  })
  @ApiResponse({
    status: 200,
    description: 'Top clients by revenue (outgoing accepted invoices)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async topClients(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.analyticsService.topClients(ctx.tenantId);
  }

  @Get('price-trends')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Price trends for an item over time (incoming invoices)',
  })
  @ApiQuery({ name: 'itemName', required: true })
  @ApiQuery({ name: 'months', required: false })
  @ApiResponse({
    status: 200,
    description: 'Price trends for an item over time (incoming invoices)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
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

  @Get('revenue-vs-expenses')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Monthly revenue vs expenses for last N months' })
  @ApiQuery({ name: 'months', required: false })
  @ApiResponse({
    status: 200,
    description: 'Monthly revenue vs expenses for last N months',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async revenueVsExpenses(
    @Req() req: Request,
    @Query('months') months?: string,
  ) {
    const ctx = this.getCtx(req);
    return this.analyticsService.revenueVsExpenses(
      ctx.tenantId,
      months ? parseInt(months, 10) : 6,
    );
  }
}
