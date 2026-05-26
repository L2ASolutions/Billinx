import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  Req,
  Res,
  Header,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiProduces,
  ApiHeader,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { ExportService } from '../export/export.service';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import { JwtGuard } from '../identity/guards/jwt.guard';
import {
  InvoiceFilterParams,
  InvoiceStatus,
  InvoiceTypeCode,
} from '../../../packages/types/invoice';

@ApiTags('Invoices')
@Controller('v1/invoices')
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
    private readonly exportService: ExportService,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  // ---------------------------------------------------------------------------
  // JSON routes
  // ---------------------------------------------------------------------------

  @Post()
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit invoice for FIRS compliance' })
  async createInvoice(
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getCtx(req);
    const result = await this.invoiceService.createInvoice(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body as any,
    );
    if (result.isDuplicate) {
      res.status(HttpStatus.OK);
      res.setHeader('X-Duplicate', 'true');
      if (result.message) res.setHeader('X-Duplicate-Message', result.message);
    } else {
      res.status(HttpStatus.CREATED);
    }
    return result.invoice;
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate invoice without submitting to FIRS' })
  async validateInvoice(@Body() body: Record<string, any>) {
    return this.invoiceService.validateInvoice(body);
  }

  // ---------------------------------------------------------------------------
  // XML routes (static segments — must precede :id param routes)
  // ---------------------------------------------------------------------------

  @Post('from-xml')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create invoice from NRS-compliant XML body' })
  @ApiConsumes('application/xml')
  async createInvoiceFromXml(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof body !== 'string' || !body.trim()) {
      throw new BadRequestException(
        'Request body must be a non-empty XML string',
      );
    }
    const ctx = this.getCtx(req);
    const result = await this.invoiceService.createInvoiceFromXml(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body,
    );
    if (result.isDuplicate) {
      res.status(HttpStatus.OK);
      res.setHeader('X-Duplicate', 'true');
      if (result.message) res.setHeader('X-Duplicate-Message', result.message);
    } else {
      res.status(HttpStatus.CREATED);
    }
    return result.invoice;
  }

  // ---------------------------------------------------------------------------
  // List / stats
  // ---------------------------------------------------------------------------

  @Get()
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invoices for authenticated tenant' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'invoiceTypeCode', required: false })
  @ApiQuery({ name: 'sellerTin', required: false })
  @ApiQuery({ name: 'buyerTin', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listInvoices(
    @Req() req: Request,
    @Query('status') status?: InvoiceStatus,
    @Query('invoiceTypeCode') invoiceTypeCode?: InvoiceTypeCode,
    @Query('sellerTin') sellerTin?: string,
    @Query('buyerTin') buyerTin?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const ctx = this.getCtx(req);
    const filters: InvoiceFilterParams = {
      status,
      invoiceTypeCode,
      sellerTin,
      buyerTin,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    };
    return this.invoiceService.listInvoices(ctx.tenantId, filters);
  }

  @Get('stats')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice statistics for tenant' })
  async getInvoiceStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStats(ctx.tenantId);
  }

  @Get('check')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Check if invoice exists by sourceReference — for ERP recovery after power failure',
  })
  @ApiQuery({ name: 'sourceReference', required: true })
  async checkBySourceReference(
    @Req() req: Request,
    @Query('sourceReference') sourceReference: string,
  ) {
    if (!sourceReference) {
      throw new BadRequestException('sourceReference query param is required');
    }
    const ctx = this.getCtx(req);
    return this.invoiceService.checkBySourceReference(
      ctx.tenantId,
      sourceReference,
    );
  }

  // ---------------------------------------------------------------------------
  // Export routes (static segments — must precede :id param routes)
  // ---------------------------------------------------------------------------

  @Get('export/csv')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export invoices as CSV for compliance reporting' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async exportCSV(
    @Req() req: Request,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    const csv = await this.exportService.exportInvoicesCSV(
      ctx.tenantId,
      startDate,
      endDate,
    );
    return csv;
  }

  @Get('export/json')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export invoices as JSON in NRS canonical format' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async exportJSON(
    @Req() req: Request,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    return this.exportService.exportInvoicesJSON(
      ctx.tenantId,
      startDate,
      endDate,
    );
  }

  @Get('export/monthly')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get monthly invoice summary report' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  async exportMonthly(
    @Req() req: Request,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const ctx = this.getCtx(req);
    if (!year || !month) {
      throw new BadRequestException('year and month are required');
    }
    return this.exportService.exportMonthlyReport(
      ctx.tenantId,
      Number(year),
      Number(month),
    );
  }

  // ---------------------------------------------------------------------------
  // Single-invoice routes — :id param
  // ---------------------------------------------------------------------------

  @Get(':id')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get invoice by ID (JSON or XML via Accept header)',
  })
  @ApiHeader({
    name: 'Accept',
    required: false,
    description: 'application/json (default) or application/xml',
  })
  @ApiProduces('application/json', 'application/xml')
  async getInvoice(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('accept') accept?: string,
  ) {
    const ctx = this.getCtx(req);
    if (accept?.includes('application/xml')) {
      const xml = await this.invoiceService.exportAsXml(id, ctx.tenantId);
      res.setHeader('Content-Type', 'application/xml');
      return xml;
    }
    return this.invoiceService.getInvoice(id, ctx.tenantId);
  }

  @Get(':id/xml')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice as NRS-compliant XML' })
  @Header('Content-Type', 'application/xml')
  @ApiProduces('application/xml')
  async getInvoiceXml(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.exportAsXml(id, ctx.tenantId);
  }

  @Get(':id/status')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice lifecycle status and history' })
  async getInvoiceStatus(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStatus(id, ctx.tenantId);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an accepted invoice' })
  async cancelInvoice(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.cancelInvoice(
      id,
      ctx.tenantId,
      ctx.actor,
      body as any,
    );
  }

  // ---------------------------------------------------------------------------
  // Payment routes (API key auth — callable by ERPs)
  // ---------------------------------------------------------------------------

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a payment against an accepted invoice' })
  async recordPayment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.paymentService.recordPayment(id, ctx.tenantId, ctx.actor, {
      amount: body.amount,
      reference: body.reference,
      provider: body.provider,
      paidAt: body.paidAt,
      notes: body.notes,
      metadata: body.metadata,
    });
  }

  @Get(':id/payments')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payment records for an invoice' })
  async listPayments(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.paymentService.listPayments(id, ctx.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Dashboard routes (JWT auth)
  // ---------------------------------------------------------------------------

  @Post('dashboard')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create invoice from dashboard (JWT auth)' })
  async createInvoiceDashboard(
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getCtx(req);
    const result = await this.invoiceService.createInvoice(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body as any,
    );
    if (result.isDuplicate) {
      res.status(HttpStatus.OK);
      res.setHeader('X-Duplicate', 'true');
      if (result.message) res.setHeader('X-Duplicate-Message', result.message);
    } else {
      res.status(HttpStatus.CREATED);
    }
    return result.invoice;
  }

  @Get('dashboard/list')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invoices from dashboard (JWT auth)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'paymentStatus', required: false })
  @ApiQuery({ name: 'isOverdue', required: false, type: Boolean })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listInvoicesDashboard(
    @Req() req: Request,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('isOverdue') isOverdue?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.listInvoices(ctx.tenantId, {
      status,
      search,
      paymentStatus,
      isOverdue: isOverdue === 'true',
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('dashboard/stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice stats for dashboard (JWT auth)' })
  async getDashboardStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getDashboardStats(ctx.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Single-invoice dashboard routes (JWT auth)
  // These mirror the ApiKeyGuard :id routes so the dashboard UI can view,
  // cancel, and manage payments on individual invoices without an API key.
  // Static segments above (dashboard/list, dashboard/stats) take priority over
  // the dynamic :id segment — no route conflict.
  // ---------------------------------------------------------------------------

  @Get('dashboard/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single invoice by ID (dashboard / JWT auth)' })
  async getDashboardInvoice(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoice(id, ctx.tenantId);
  }

  @Get('dashboard/:id/xml')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Header('Content-Type', 'application/xml')
  @ApiProduces('application/xml')
  @ApiOperation({ summary: 'Download invoice as NRS XML (dashboard / JWT auth)' })
  async getDashboardInvoiceXml(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.exportAsXml(id, ctx.tenantId);
  }

  @Get('dashboard/:id/status')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice lifecycle status (dashboard / JWT auth)' })
  async getDashboardInvoiceStatus(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStatus(id, ctx.tenantId);
  }

  @Patch('dashboard/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an invoice (dashboard / JWT auth)' })
  async cancelInvoiceDashboard(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.cancelInvoice(
      id,
      ctx.tenantId,
      ctx.actor,
      body as any,
    );
  }

  @Post('dashboard/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a payment against an invoice (dashboard / JWT auth)' })
  async recordPaymentDashboard(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.paymentService.recordPayment(id, ctx.tenantId, ctx.actor, {
      amount: body.amount,
      reference: body.reference,
      provider: body.provider,
      paidAt: body.paidAt,
      notes: body.notes,
      metadata: body.metadata,
    });
  }

  @Get('dashboard/:id/payments')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payments for an invoice (dashboard / JWT auth)' })
  async listPaymentsDashboard(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.paymentService.listPayments(id, ctx.tenantId);
  }
}
