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
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import { ActivityService } from './services/activity.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { FlexAuthGuard } from '../identity/guards/flex-auth.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
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
  @UseGuards(FlexAuthGuard)
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

  @Get('activity/export-excel')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiOperation({ summary: 'Export audit log as Excel — OWNER and ADMIN only' })
  async exportAuditLogExcel(
    @Req() req: Request,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('eventType') eventType?: string,
  ) {
    const { getRequestContext } =
      await import('../../shared/context/request-context');
    const ctx = getRequestContext();

    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);

    const events = await this.activityService.getActivityForExport({
      tenantId: ctx.tenantId,
      eventType,
      from: start.toISOString(),
      to: end.toISOString(),
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Billinx';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Audit Log');
    sheet.columns = [
      { header: 'Timestamp',   key: 'timestamp',  width: 22 },
      { header: 'Actor',       key: 'actor',      width: 28 },
      { header: 'Event Type',  key: 'eventType',  width: 28 },
      { header: 'Entity Type', key: 'entityType', width: 16 },
      { header: 'Entity ID',   key: 'entityId',   width: 36 },
      { header: 'IP Address',  key: 'ipAddress',  width: 16 },
      { header: 'Details',     key: 'details',    width: 60 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    const fmtDate = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      );
    };

    const resolveActor = (e: (typeof events)[0]) => {
      if (e.actorName) return e.actorName;
      if (e.actorEmail) return e.actorEmail;
      const a = e.actor ?? '';
      if (a.startsWith('system:')) return a.replace('system:', '') + ' (system)';
      if (a.startsWith('user:')) return a.replace('user:', '').substring(0, 8) + '…';
      return a;
    };

    for (const e of events) {
      const details =
        e.payload && Object.keys(e.payload).length > 0
          ? JSON.stringify(e.payload)
          : '';
      sheet.addRow({
        timestamp:  fmtDate(e.occurredAt),
        actor:      resolveActor(e),
        eventType:  e.eventType,
        entityType: e.entityType ?? '',
        entityId:   e.entityId ?? '',
        ipAddress:  e.ipAddress ?? '',
        details,
      });
    }

    const today = new Date().toISOString().split('T')[0];
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Billinx_AuditLog_${today}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }

  @Get('activity/export')
  @UseGuards(FlexAuthGuard)
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
