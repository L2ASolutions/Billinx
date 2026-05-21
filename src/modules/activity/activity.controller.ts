import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { ActivityService } from './services/activity.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import {
  ActivityEventType,
  ErrorSeverity,
} from '../../../packages/types/activity';

@ApiTags('Activity & Errors')
@Controller('v1')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  // ── Activity endpoints (tenant-scoped) ─────────────────────────────────────

  @Get('activity')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'List activity events for authenticated tenant' })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTenantActivity(
    @Query('eventType') eventType?: ActivityEventType,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { getRequestContext } =
      await import('../../shared/context/request-context');
    const ctx = getRequestContext();
    return this.activityService.getActivity({
      tenantId: ctx.tenantId,
      eventType,
      entityId,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('activity/export')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Export activity as CSV for authenticated tenant' })
  @ApiHeader({ name: 'Authorization', required: true })
  async exportTenantActivity(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Res() res?: Response,
  ) {
    const { getRequestContext } =
      await import('../../shared/context/request-context');
    const ctx = getRequestContext();
    const csv = await this.activityService.exportActivityCsv({
      tenantId: ctx.tenantId,
      from,
      to,
    });

    res!.setHeader('Content-Type', 'text/csv');
    res!.setHeader(
      'Content-Disposition',
      `attachment; filename="activity-${ctx.tenantId}-${Date.now()}.csv"`,
    );
    res!.send(csv);
  }

  // ── Admin activity endpoints (platform-wide) ──────────────────────────────

  @Get('admin/activity')
  @UseGuards(AdminJwtGuard)
  @ApiOperation({ summary: 'Admin: list all activity across all tenants' })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAllActivity(
    @Query('tenantId') tenantId?: string,
    @Query('eventType') eventType?: ActivityEventType,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.activityService.getActivity({
      tenantId,
      eventType,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  // ── Admin error endpoints ─────────────────────────────────────────────────

  @Get('admin/errors')
  @UseGuards(AdminJwtGuard)
  @ApiOperation({ summary: 'Admin: list system errors' })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'isResolved', required: false, type: Boolean })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getErrors(
    @Query('severity') severity?: ErrorSeverity,
    @Query('isResolved') isResolved?: string,
    @Query('tenantId') tenantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.activityService.getErrors({
      severity,
      isResolved: isResolved !== undefined ? isResolved === 'true' : undefined,
      tenantId,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('admin/errors/stats')
  @UseGuards(AdminJwtGuard)
  @ApiOperation({ summary: 'Admin: get error statistics' })
  @ApiHeader({ name: 'Authorization', required: true })
  async getErrorStats() {
    return this.activityService.getErrorStats();
  }

  @Patch('admin/errors/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiOperation({ summary: 'Admin: mark an error as resolved' })
  @ApiHeader({ name: 'Authorization', required: true })
  async resolveError(
    @Param('id') id: string,
    @Body() body: { resolvedBy: string; resolutionNote?: string },
  ) {
    return this.activityService.resolveError(
      id,
      body.resolvedBy,
      body.resolutionNote,
    );
  }
}
