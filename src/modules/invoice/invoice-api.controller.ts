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
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { ApiKeyGuard } from '../identity/guards/api-key.guard';
import {
  InvoiceFilterParams,
  InvoiceStatus,
  InvoiceTypeCode,
} from '../../../packages/types/invoice';

const CREATE_INVOICE_EXAMPLE = {
  invoiceKind: 'B2B',
  invoiceTypeCode: '380',
  currencyCode: 'NGN',
  issueDate: '2026-07-18',
  supplierParty: {
    tin: '12345678-0001',
    name: 'Acme Corp',
    streetName: '1 Marina Street',
    cityName: 'Lagos',
  },
  buyerParty: {
    tin: '87654321-0001',
    name: 'Beta Traders Ltd',
  },
  lineItems: [
    {
      description: 'Consulting services',
      quantity: 1,
      unitPrice: 500000,
      hsnCode: '998311',
      productCategory: 'SERVICES',
    },
  ],
  legalMonetaryTotal: {
    lineExtensionAmount: 500000,
    taxExclusiveAmount: 500000,
    taxInclusiveAmount: 537500,
    payableAmount: 537500,
  },
};

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('v1/invoices')
export class InvoiceApiController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  // ---------------------------------------------------------------------------
  // JSON routes
  // ---------------------------------------------------------------------------

  @Post()
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Submit invoice for FIRS compliance',
    description:
      'Creates a DRAFT invoice, runs FIRS/NRS field validation, generates an IRN, and queues it ' +
      'for asynchronous submission to the NRS platform via the configured adapter (Interswitch in ' +
      'production, Mock in development). Returns immediately with the created invoice — poll ' +
      '`GET /v1/invoices/:id/status` or subscribe to the `invoice.accepted`/`invoice.rejected` webhook ' +
      'for the final FIRS outcome. Idempotent on repeated calls with the same `Idempotency-Key` header.',
  })
  @ApiBody({
    description: 'NRS-compliant invoice payload',
    examples: {
      standardInvoice: {
        summary: 'Standard B2B invoice',
        value: CREATE_INVOICE_EXAMPLE,
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Invoice created and queued for submission',
    schema: {
      example: {
        ...CREATE_INVOICE_EXAMPLE,
        id: 'inv_01h...',
        status: 'QUEUED',
        platformIrn: 'IRN-...',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Duplicate request replayed (see X-Duplicate header)',
  })
  @ApiResponse({
    status: 400,
    description: 'Invoice failed FIRS/NRS field validation',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
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
  @ApiOperation({
    summary: 'Validate invoice without submitting to FIRS',
    description:
      'Runs the same FIRS/NRS field validation rules as submission, but collects every error into ' +
      'a single response instead of throwing on the first one — intended for pre-flight checks before ' +
      'a real submission. Never creates an invoice or touches the network.',
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result with a list of any field errors found',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  async validateInvoice(@Body() body: Record<string, any>) {
    return this.invoiceService.validateInvoice(body);
  }

  // ---------------------------------------------------------------------------
  // XML routes (static segments — must precede :id param routes)
  // ---------------------------------------------------------------------------

  @Post('from-xml')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Create invoice from NRS-compliant XML body',
    description:
      'Same behaviour as `POST /v1/invoices`, but accepts a UBL/NRS XML document instead of JSON — ' +
      'for ERP integrations that already produce XML invoices.',
  })
  @ApiConsumes('application/xml')
  @ApiResponse({
    status: 201,
    description: 'Invoice created and queued for submission',
  })
  @ApiResponse({
    status: 400,
    description:
      'Body was not a well-formed, non-empty XML string, or failed validation',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
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
  @ApiOperation({
    summary: 'List invoices for authenticated tenant',
    description:
      "Paginated, filterable list of invoices belonging to the calling API key's tenant.",
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'invoiceTypeCode', required: false })
  @ApiQuery({ name: 'sellerTin', required: false })
  @ApiQuery({ name: 'buyerTin', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of invoices' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
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
  @ApiOperation({
    summary: 'Get invoice statistics for tenant',
    description:
      'Aggregate counts by status/kind for the calling tenant, used for ERP dashboards.',
  })
  @ApiResponse({ status: 200, description: 'Invoice statistics' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  async getInvoiceStats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStats(ctx.tenantId);
  }

  @Get('check')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary:
      'Check if invoice exists by sourceReference — for ERP recovery after power failure',
    description:
      'Lets an ERP that lost track of whether a submission actually reached Billinx (e.g. after a ' +
      'crash mid-request) recover the invoice by the client-supplied `sourceReference` instead of ' +
      're-submitting and risking a duplicate.',
  })
  @ApiQuery({ name: 'sourceReference', required: true })
  @ApiResponse({
    status: 200,
    description: 'Invoice found for the given sourceReference',
  })
  @ApiResponse({
    status: 400,
    description: 'sourceReference query param missing',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'No invoice found for the given sourceReference',
  })
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
  // Single-invoice routes — :id param
  // ---------------------------------------------------------------------------

  @Get(':id')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Get invoice by ID (JSON or XML via Accept header)',
    description:
      'Returns the invoice as JSON by default; send `Accept: application/xml` to instead receive the ' +
      'NRS-compliant XML representation.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiHeader({
    name: 'Accept',
    required: false,
    description: 'application/json (default) or application/xml',
  })
  @ApiProduces('application/json', 'application/xml')
  @ApiResponse({ status: 200, description: 'Invoice found' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
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
  @ApiOperation({
    summary: 'Get invoice as NRS-compliant XML',
    description:
      'Kept alongside the newer PDF export for API/ERP consumers that depend on the XML representation.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @Header('Content-Type', 'application/xml')
  @ApiProduces('application/xml')
  @ApiResponse({ status: 200, description: 'NRS-compliant XML document' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
  async getInvoiceXml(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.exportAsXml(id, ctx.tenantId);
  }

  @Get(':id/status')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Get invoice lifecycle status and history',
    description:
      'Returns the current state-machine status plus the full InvoiceStateHistory audit trail.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'Current status and state history' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
  async getInvoiceStatus(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.invoiceService.getInvoiceStatus(id, ctx.tenantId);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Cancel an accepted invoice',
    description:
      'Requests cancellation of a previously-accepted invoice via the NRS platform.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'Cancellation requested/applied' })
  @ApiResponse({
    status: 400,
    description: 'Invoice is not in a cancellable state',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
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
  @ApiOperation({
    summary: 'Record a payment against an accepted invoice',
    description:
      'Records a full or partial payment and enqueues an NRS UpdateStatus job to reflect it upstream.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payment payload, or invoice not in ACCEPTED state',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
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
  @ApiOperation({
    summary: 'List payment records for an invoice',
    description:
      'Returns every recorded payment (full or partial) against the given invoice.',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'List of payment records' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({
    status: 404,
    description: 'Invoice not found for this tenant',
  })
  async listPayments(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.paymentService.listPayments(id, ctx.tenantId);
  }
}
