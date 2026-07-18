import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { BulkInvoiceService } from './bulk-invoice.service';
import { ApiKeyGuard } from '../../identity/guards/api-key.guard';
import { JwtGuard } from '../../identity/guards/jwt.guard';

@ApiTags('Invoices')
@Controller('v1/invoices/bulk')
export class BulkInvoiceController {
  constructor(private readonly bulkService: BulkInvoiceService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit up to 500 invoices in a single bulk request',
    description:
      'Validates each invoice independently. Valid invoices are queued immediately. ' +
      'Returns per-invoice result. Rate limited: 3 requests per minute per tenant.',
  })
  @ApiResponse({
    status: 202,
    description: 'Submit up to 500 invoices in a single bulk request',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async bulkSubmit(@Body() body: Record<string, any>, @Req() req: Request) {
    const ctx = this.getCtx(req);
    const invoices = body.invoices;
    if (!Array.isArray(invoices)) {
      throw new BadRequestException(
        'Request body must contain an "invoices" array',
      );
    }
    return this.bulkService.processBulkJson(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      invoices,
    );
  }

  @Post('csv')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Submit invoices via CSV file upload (max 5 MB, 500 rows)',
    description:
      'Required CSV columns: seller_tin, seller_name, buyer_name, issue_date, subtotal, vat_amount, total_amount. ' +
      'Optional: buyer_tin, invoice_type_code, invoice_kind, currency, due_date, source_reference, note, ' +
      'description, line_items (JSON), tax_total (JSON), legal_monetary_total (JSON). ' +
      'Returns same summary format as the JSON bulk endpoint.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype === 'text/csv' ||
          file.originalname.toLowerCase().endsWith('.csv')
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV files are accepted'), false);
        }
      },
    }),
  )
  @ApiResponse({
    status: 202,
    description: 'Submit invoices via CSV file upload (max 5 MB, 500 rows)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async bulkSubmitCsv(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException(
        'A CSV file is required (field name: file)',
      );
    }
    const ctx = this.getCtx(req);
    return this.bulkService.processBulkCsv(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      file.buffer,
      file.originalname,
    );
  }

  @Get(':batchId/status')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'batchId',
    description: 'Bulk batch ID returned at submission time',
  })
  @ApiOperation({
    summary: 'Get processing progress for a bulk submission batch',
  })
  @ApiResponse({
    status: 200,
    description: 'Get processing progress for a bulk submission batch',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getBatchStatus(@Param('batchId') batchId: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.bulkService.getBatchStatus(ctx.tenantId, batchId);
  }

  // ---------------------------------------------------------------------------
  // Dashboard bulk routes (JWT auth — for the dashboard upload modal)
  // ---------------------------------------------------------------------------

  @Post('dashboard/csv')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload CSV for bulk submission (dashboard / JWT auth)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype === 'text/csv' ||
          file.originalname.toLowerCase().endsWith('.csv')
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV files are accepted'), false);
        }
      },
    }),
  )
  @ApiResponse({
    status: 202,
    description: 'Upload CSV for bulk submission (dashboard / JWT auth)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async bulkSubmitCsvDashboard(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException(
        'A CSV file is required (field name: file)',
      );
    }
    const ctx = this.getCtx(req);
    return this.bulkService.processBulkCsv(
      ctx.tenantId,
      ctx.environment,
      ctx.actor,
      file.buffer,
      file.originalname,
    );
  }

  @Get('dashboard/:batchId/status')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'batchId', description: 'Bulk batch ID' })
  @ApiOperation({ summary: 'Get bulk batch status (dashboard / JWT auth)' })
  @ApiResponse({
    status: 200,
    description: 'Get bulk batch status (dashboard / JWT auth)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getBatchStatusDashboard(
    @Param('batchId') batchId: string,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.bulkService.getBatchStatus(ctx.tenantId, batchId);
  }
}
