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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { IncomingInvoiceService } from './incoming-invoice.service';
import {
  CreateIncomingInvoiceDto,
  RejectIncomingInvoiceDto,
  MarkPaidIncomingInvoiceDto,
} from './dto/create-incoming-invoice.dto';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Incoming Invoices')
@Controller('v1/incoming-invoices')
@UseGuards(JwtGuard)
@ApiBearerAuth()
export class IncomingInvoiceController {
  constructor(
    private readonly incomingInvoiceService: IncomingInvoiceService,
  ) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an incoming invoice manually' })
  @ApiResponse({ status: 201, description: 'Invoice created' })
  @ApiResponse({ status: 409, description: 'Duplicate invoice' })
  async create(
    @Body() dto: CreateIncomingInvoiceDto,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.create(ctx.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List incoming invoices with optional filters' })
  @ApiQuery({ name: 'status', required: false, enum: ['RECEIVED', 'VALIDATED', 'REJECTED', 'APPROVED', 'PAID'] })
  @ApiQuery({ name: 'supplierTin', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('supplierTin') supplierTin?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.list(ctx.tenantId, {
      status,
      supplierTin,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get incoming invoice stats for dashboard' })
  async stats(@Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.getStats(ctx.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get incoming invoice by ID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.findById(id, ctx.tenantId);
  }

  @Patch(':id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an incoming invoice' })
  @ApiResponse({ status: 400, description: 'Validation checks failed' })
  async validate(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.validate(id, ctx.tenantId);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve an incoming invoice (OWNER or ADMIN only)' })
  @ApiResponse({ status: 403, description: 'Requires OWNER or ADMIN role' })
  async approve(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.approve(id, ctx.tenantId);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an incoming invoice' })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectIncomingInvoiceDto,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.reject(id, ctx.tenantId, dto);
  }

  @Patch(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an approved incoming invoice as paid' })
  async markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidIncomingInvoiceDto,
    @Req() req: Request,
  ) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.markPaid(id, ctx.tenantId, dto);
  }

  @Post(':id/send-receipt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send payment receipt email to supplier' })
  async sendReceipt(@Param('id') id: string, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.incomingInvoiceService.sendReceipt(id, ctx.tenantId);
  }
}
