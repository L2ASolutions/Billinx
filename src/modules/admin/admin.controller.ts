import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AdminService } from './services/admin.service';
import { AdminKeyGuard } from '../identity/guards/admin-key.guard';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminIpGuard } from '../../shared/guards/admin-ip.guard';
import { RecoveryService } from '../../shared/recovery/recovery.service';
import { ReminderService } from '../reminder/services/reminder.service';
import {
  AdminLoginRequest,
  CreateAdminUserRequest,
} from '../../../packages/types/admin';

@ApiTags('Admin')
@Controller('v1/admin')
@UseGuards(AdminIpGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly recoveryService: RecoveryService,
    private readonly reminderService: ReminderService,
  ) {}

  private getAdminCtx(req: Request): any {
    return (req as any)._adminContext;
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminKeyGuard)
  @ApiHeader({ name: 'X-Admin-Key', required: true })
  @ApiOperation({ summary: 'Create an admin user (L2A Solutions staff)' })
  @ApiResponse({
    status: 201,
    description: 'Create an admin user (L2A Solutions staff)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin key' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async createAdminUser(@Body() body: Record<string, any>) {
    return this.adminService.createAdminUser(body as CreateAdminUserRequest);
  }

  @Get('users')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all admin users' })
  @ApiResponse({ status: 200, description: 'List all admin users' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async listAdminUsers() {
    return this.adminService.listAdminUsers();
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Admin login with email and password',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async login(@Body() body: Record<string, any>) {
    return this.adminService.login(body as AdminLoginRequest);
  }

  @Get('dashboard')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform-wide dashboard statistics' })
  @ApiResponse({
    status: 200,
    description: 'Get platform-wide dashboard statistics',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('tenants')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all tenants on the platform' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List all tenants on the platform' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async listTenants(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.listTenants(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('tenants/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get full detail for a specific tenant' })
  @ApiResponse({
    status: 200,
    description: 'Get full detail for a specific tenant',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getTenantDetail(@Param('id') id: string) {
    return this.adminService.getTenantDetail(id);
  }

  @Get('access-requests')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all access requests' })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({ status: 200, description: 'List all access requests' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async listAccessRequests(@Query('status') status?: string) {
    return this.adminService.listAccessRequests(status);
  }

  @Post('access-requests/:id/provision')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve request and auto-provision tenant' })
  @ApiResponse({
    status: 200,
    description: 'Approve request and auto-provision tenant',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async approveAndProvision(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.approveAndProvision(id, ctx.adminId, {
      appAdapterKey: body.appAdapterKey,
      environment: body.environment,
      reviewNote: body.reviewNote,
    });
  }

  @Post('users/unlock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlock a locked user account' })
  @ApiResponse({ status: 200, description: 'Unlock a locked user account' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async unlockAccount(@Body() body: Record<string, any>) {
    return this.adminService.unlockAccount(body.tenantId, body.email);
  }

  @Patch('access-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject an access request' })
  @ApiResponse({ status: 200, description: 'Reject an access request' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async rejectAccessRequest(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.rejectAccessRequest(
      id,
      ctx.adminId,
      body.reviewNote,
    );
  }

  // ── Consent records ────────────────────────────────────────────────────────
  @Get('consent-records')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: list consent records (NDPA 2023)' })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'email', required: false })
  @ApiQuery({
    name: 'consentType',
    required: false,
    enum: [
      'TERMS_AND_PRIVACY',
      'NDPR_DATA_PROCESSING',
      'BUSINESS_AUTHORISATION',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Admin: list consent records (NDPA 2023)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async listConsentRecords(
    @Query('tenantId') tenantId?: string,
    @Query('email') email?: string,
    @Query('consentType') consentType?: string,
  ) {
    return this.adminService.listConsentRecords({
      tenantId,
      email,
      consentType,
    });
  }

  // ── Erasure requests ───────────────────────────────────────────────────────
  @Get('erasure-requests')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: list right-to-erasure requests' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
  })
  @ApiResponse({
    status: 200,
    description: 'Admin: list right-to-erasure requests',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async listErasureRequests(@Query('status') status?: string) {
    return this.adminService.listErasureRequests(status);
  }

  @Post('erasure-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admin: approve erasure request — anonymises user PII (NDPA 2023)',
  })
  @ApiParam({ name: 'id', description: 'Erasure request ID' })
  @ApiResponse({
    status: 200,
    description:
      'Admin: approve erasure request — anonymises user PII (NDPA 2023)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async approveErasure(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.approveErasure(id, ctx.adminId, body.reviewNote);
  }

  @Post('erasure-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: reject an erasure request' })
  @ApiParam({ name: 'id', description: 'Erasure request ID' })
  @ApiResponse({ status: 200, description: 'Admin: reject an erasure request' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async rejectErasure(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getAdminCtx(req);
    return this.adminService.rejectErasure(id, ctx.adminId, body.reviewNote);
  }

  // ── Metrics ────────────────────────────────────────────────────────────────
  @Get('metrics')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform-wide invoice and webhook metrics' })
  @ApiResponse({
    status: 200,
    description: 'Get platform-wide invoice and webhook metrics',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async getMetrics() {
    return this.adminService.getMetrics();
  }

  // ── Queue monitoring ───────────────────────────────────────────────────────
  @Get('queue/status')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get submission queue job counts' })
  @ApiResponse({ status: 200, description: 'Get submission queue job counts' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async getQueueStatus() {
    return this.adminService.getQueueStatus();
  }

  @Post('queue/retry-failed')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Re-queue all failed submission jobs' })
  @ApiResponse({
    status: 200,
    description: 'Re-queue all failed submission jobs',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async retryFailedJobs() {
    return this.adminService.retryFailedJobs();
  }

  @Get('queue/bulk/status')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get bulk submission queue depth and processing stats',
  })
  @ApiResponse({
    status: 200,
    description: 'Get bulk submission queue depth and processing stats',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async getBulkQueueStatus() {
    return this.adminService.getBulkQueueStatus();
  }

  // ── Data retention ────────────────────────────────────────────────────────
  @Get('retention/stats')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get data retention statistics' })
  @ApiResponse({ status: 200, description: 'Get data retention statistics' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async getRetentionStats() {
    return this.adminService.getRetentionStats();
  }

  @Post('retention/run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually trigger data retention archiving' })
  @ApiResponse({
    status: 200,
    description: 'Manually trigger data retention archiving',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async runRetention() {
    return this.adminService.runRetention();
  }

  // ── Platform CSV export ────────────────────────────────────────────────────
  @Get('export/platform-csv')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export all invoices across all tenants as CSV' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiResponse({
    status: 200,
    description: 'Export all invoices across all tenants as CSV',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async exportPlatformCSV(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    return this.adminService.exportPlatformCSV(startDate, endDate);
  }

  // ── Audit chain verification ───────────────────────────────────────────────
  @Get('audit/verify')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify the integrity of the hash-chained immutable audit log',
  })
  @ApiResponse({
    status: 200,
    description: 'Verify the integrity of the hash-chained immutable audit log',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async verifyAuditChain() {
    return this.adminService.verifyAuditChain();
  }

  // ── Power-failure recovery ─────────────────────────────────────────────────
  @Post('recovery/run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Manually trigger startup reconciliation — resets stuck SUBMITTING invoices',
  })
  @ApiResponse({
    status: 200,
    description:
      'Manually trigger startup reconciliation — resets stuck SUBMITTING invoices',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async runRecovery() {
    return this.recoveryService.reconcileStuckInvoices();
  }

  // ── Reminder engine ────────────────────────────────────────────────────────
  @Post('reminders/run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manually trigger the payment reminder check across all tenants',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'Scope to a single tenant',
  })
  @ApiResponse({
    status: 200,
    description:
      'Manually trigger the payment reminder check across all tenants',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async runReminders(@Query('tenantId') tenantId?: string) {
    return this.reminderService.runReminderCheck(tenantId);
  }
}
