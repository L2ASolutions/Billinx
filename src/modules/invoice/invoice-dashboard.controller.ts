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
  Res,
  Header,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiProduces,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import {
  InterswitchAdapter,
  NrsValidationError,
} from '../submission/adapters/interswitch/interswitch.adapter';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { InvoiceStatus } from '../../../packages/types/invoice';
import { InvoiceDashboardFilterDto } from './dto/invoice-dashboard-filter.dto';

@ApiTags('Invoices')
@Controller('v1/invoices/dashboard')
export class InvoiceDashboardController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly interswitchAdapter: InterswitchAdapter,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post('save-draft')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Save a new DRAFT invoice without queuing for FIRS submission',
  })
  async saveDraftDashboard(
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.saveDraftInvoice(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      body,
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update fields of an existing DRAFT invoice without submitting',
  })
  async updateDraftDashboard(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.updateDraftFields(
      id,
      ctx.tenantId,
      ctx.actor,
      body,
    );
  }

  @Post()
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
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

  @Get('list')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invoices from dashboard (JWT auth)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'paymentStatus', required: false })
  @ApiQuery({ name: 'isOverdue', required: false, type: Boolean })
  @ApiQuery({ name: 'forPayments', required: false, type: Boolean })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listInvoicesDashboard(
    @Req() req: Request,
    @Query() filters: InvoiceDashboardFilterDto,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.listInvoices(ctx.tenantId, {
      status: filters.status as InvoiceStatus,
      search: filters.search,
      paymentStatus: filters.paymentStatus,
      isOverdue: filters.isOverdue,
      forPayments: filters.forPayments,
      from: filters.from,
      to: filters.to,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    });
  }

  @Get('sample')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get a static sample invoice for onboarding reference (dashboard / JWT auth)',
  })
  getSampleInvoice() {
    return this.invoiceService.getSampleInvoice();
  }

  @Get('stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invoice stats for dashboard (JWT auth)' })
  async getDashboardStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    const userId =
      ctx.actorType === 'user' ? ctx.actor.replace('user:', '') : undefined;
    return this.invoiceService.getDashboardStats(ctx.tenantId, userId);
  }

  @Get('charts')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get chart data for dashboard (JWT auth)' })
  async getDashboardCharts(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getDashboardCharts(ctx.tenantId);
  }

  @Get('rejections')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get FIRS rejection summary for dashboard (JWT auth)',
  })
  async getDashboardRejections(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getDashboardRejections(ctx.tenantId);
  }

  @Get('payment-stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get payment collection stats for dashboard (JWT auth)',
  })
  async getPaymentStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getPaymentStats(ctx.tenantId);
  }

  @Get('payment-charts')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get payment chart data (collection trend + payment methods) for dashboard (JWT auth)',
  })
  async getPaymentCharts(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getPaymentCharts(ctx.tenantId);
  }

  @Get('export')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({
    summary: 'Export sent invoices as Excel (dashboard / JWT auth)',
  })
  async exportInvoicesDashboard(
    @Req() req: Request,
    @Res() res: Response,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const ctx = this.getCtx(req);
    const result = await this.invoiceService.listInvoices(ctx.tenantId, {
      status,
      search,
      from,
      to,
      page: 1,
      limit: 1000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Billinx';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Invoices');
    sheet.columns = [
      { header: 'Invoice #', key: 'irn', width: 32 },
      { header: 'Buyer', key: 'buyer', width: 28 },
      { header: 'Issue Date', key: 'issueDate', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 14 },
      { header: 'Subtotal', key: 'subtotal', width: 16 },
      { header: 'VAT', key: 'vat', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'FIRS Status', key: 'status', width: 18 },
      { header: 'Payment Status', key: 'paymentStatus', width: 16 },
    ];

    const fmtDate = (d?: string) =>
      d ? new Date(d).toLocaleDateString('en-GB') : '';

    for (const inv of result.data) {
      sheet.addRow({
        irn: inv.firsConfirmedIrn ?? inv.platformIrn,
        buyer: inv.buyerName,
        issueDate: fmtDate(inv.issueDate),
        dueDate: fmtDate(inv.paymentDueDate ?? inv.dueDate),
        subtotal: inv.subtotal,
        vat: inv.vatAmount,
        total: inv.totalAmount,
        currency: inv.currency,
        status: inv.status,
        paymentStatus: inv.paymentStatus ?? '',
      });
    }

    const today = new Date().toISOString().split('T')[0];
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoices-${today}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }

  // ---------------------------------------------------------------------------
  // Single-invoice dashboard routes (JWT auth)
  // These mirror the ApiKeyGuard :id routes on InvoiceApiController so the
  // dashboard UI can view, cancel, and manage payments on individual invoices
  // without an API key. Static segments above (list, stats, sample, etc.) take
  // priority over the dynamic :id segment — no route conflict.
  // ---------------------------------------------------------------------------

  @Get(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a single invoice by ID (dashboard / JWT auth)',
  })
  async getDashboardInvoice(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoice(id, ctx.tenantId);
  }

  @Get(':id/xml')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Header('Content-Type', 'application/xml')
  @ApiProduces('application/xml')
  @ApiOperation({
    summary: 'Download invoice as NRS XML (dashboard / JWT auth)',
  })
  async getDashboardInvoiceXml(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.exportAsXml(id, ctx.tenantId);
  }

  @Get(':id/pdf')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Download invoice as an NRS-compliant PDF with IRN and QR code (dashboard / JWT auth)',
  })
  async getDashboardInvoicePdf(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ctx = this.getCtx(req);
    const { buffer, filename } = await this.invoicePdfService.generatePdf(
      id,
      ctx.tenantId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id/nrs-payload')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Preview the exact NRS/Interswitch JSON payload for an invoice without submitting it — diagnostic only (dashboard / JWT auth, OWNER/ADMIN)',
  })
  async getDashboardInvoiceNrsPayload(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ctx = this.getCtx(req);
    let result: { payload: Record<string, unknown>; irn: string };
    try {
      result = await this.interswitchAdapter.previewPayload(
        ctx.tenantId,
        id,
      );
    } catch (err) {
      if (err instanceof NrsValidationError) {
        if (err.errorCode === 'INVOICE_NOT_FOUND') {
          throw new NotFoundException(err.message);
        }
        throw new BadRequestException({
          errorCode: err.errorCode,
          message: err.message,
        });
      }
      throw err;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nrs-payload-${result.irn}.json"`,
    );
    res.send(JSON.stringify(result.payload, null, 2));
  }

  @Get(':id/status')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get invoice lifecycle status (dashboard / JWT auth)',
  })
  async getDashboardInvoiceStatus(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStatus(id, ctx.tenantId);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
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

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record a payment against an invoice (dashboard / JWT auth)',
  })
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

  @Get(':id/payments')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List payments for an invoice (dashboard / JWT auth)',
  })
  async listPaymentsDashboard(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.paymentService.listPayments(id, ctx.tenantId);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Duplicate an invoice as a new DRAFT (dashboard / JWT auth)',
  })
  async duplicateInvoiceDashboard(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.duplicateInvoice(
      ctx.tenantId,
      id,
      ctx.actor,
      ctx.environment,
    );
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Submit an existing DRAFT invoice (update fields + queue for FIRS submission)',
  })
  async submitDraftDashboard(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.invoiceService.submitDraft(id, ctx.tenantId, ctx.actor, body);
  }

  // ── Manual payment reminder ────────────────────────────────────────────────

  @Post(':id/reminder')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Send a manual payment reminder email to the buyer (dashboard / JWT auth)',
  })
  async sendReminderDashboard(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.sendManualReminder(id, ctx.tenantId, ctx.actor);
  }

  // ── Send to buyer ──────────────────────────────────────────────────────────

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send invoice to buyer by email (dashboard)' })
  async sendToBuyerDashboard(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.sendToBuyer(id, ctx.tenantId);
  }
}
