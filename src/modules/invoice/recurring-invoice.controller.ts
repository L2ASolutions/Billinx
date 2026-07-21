import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  RecurringInvoiceService,
  CreateRecurringInvoiceDto,
  UpdateRecurringInvoiceDto,
} from './services/recurring-invoice.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

// Mounted at v1/invoices/recurring. Must be registered before
// InvoiceApiController in invoice.module.ts's `controllers` array — that
// controller's ApiKeyGuard-protected `GET :id` (v1/invoices/:id) is a
// single-segment catch-all that would otherwise shadow GET
// v1/invoices/recurring (also a single segment past v1/invoices) and return
// 401 for JWT callers before this controller's list handler ever runs.
// Nest/Express resolves overlapping route patterns in registration order,
// not by pattern specificity — see InvoiceDashboardController's own
// static-before-:id comment for the sibling case of this within one class.
@ApiTags('Recurring Invoices')
@Controller('v1/invoices/recurring')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
@ApiBearerAuth()
export class RecurringInvoiceController {
  constructor(
    private readonly recurringInvoiceService: RecurringInvoiceService,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new recurring invoice schedule' })
  @ApiResponse({
    status: 201,
    description: 'Create a new recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async createSchedule(
    @Req() req: Request,
    @Body() body: CreateRecurringInvoiceDto,
  ) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.createSchedule(tenantId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List recurring invoice schedules for the tenant' })
  @ApiResponse({
    status: 200,
    description: 'List recurring invoice schedules for the tenant',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  async listSchedules(@Req() req: Request) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.listSchedules(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single recurring invoice schedule' })
  @ApiResponse({
    status: 200,
    description: 'Get a single recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getSchedule(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.getSchedule(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring invoice schedule' })
  @ApiResponse({
    status: 200,
    description: 'Update a recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async updateSchedule(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateRecurringInvoiceDto,
  ) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.updateSchedule(tenantId, id, body);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a recurring invoice schedule' })
  @ApiResponse({
    status: 200,
    description: 'Pause a recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 400, description: 'Schedule is not ACTIVE' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async pauseSchedule(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.pauseSchedule(tenantId, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused recurring invoice schedule' })
  @ApiResponse({
    status: 200,
    description: 'Resume a paused recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 400, description: 'Schedule is not PAUSED' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async resumeSchedule(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.resumeSchedule(tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a recurring invoice schedule' })
  @ApiResponse({
    status: 200,
    description: 'Cancel a recurring invoice schedule',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async cancelSchedule(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = this.getCtx(req);
    return this.recurringInvoiceService.cancelSchedule(tenantId, id);
  }
}
